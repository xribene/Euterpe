/**
 * The `ctx` that defineAgent hooks receive, and the conversion of a hook's return value into an MICP message.
 */
import {NoteEvent} from '../utils/NoteEvent.js';
import {
    playerType, instrumentType, noteType, messageType, statusType, uiParameterType, agentHookType,
} from '../utils/types.js';

const NOTE_TYPES = {on: noteType.NOTE_ON, off: noteType.NOTE_OFF, hold: noteType.NOTE_HOLD};
const INSTRUMENTS = {piano: instrumentType.PIANO, drums: instrumentType.DRUMS, bass: instrumentType.BASS,
    synth: instrumentType.SYNTH};

// what a hook may return, by name
const MESSAGE_KEYS = {
    notes: messageType.NOTE_LIST, text: messageType.TEXT, label: messageType.LABEL, vector: messageType.VECTOR,
    key: messageType.KEY, session: messageType.SESSION, timingReset: messageType.TIMING_RESET,
    status: messageType.STATUS, humanToken: messageType.HUMAN_TOKEN,
};

// uiParameterType index -> {kind, id}, e.g. 0 -> {kind: 'slider', id: 1}
const WIDGETS = Object.fromEntries(Object.entries(uiParameterType).map(([name, index]) => {
    const [kind, id] = name.split('_');
    return [index, {kind: kind.toLowerCase(), id: Number(id)}];
}));

/**
 * @param {Object} init - The INIT_AGENT content (config, urlParams).
 * @return {Object} ctx
 */
export function createContext(init) {
    const config = init.config;
    const clock = config.clockSettings ?? {};
    // the page's clock in the worker: user notes' createdAt.seconds are on it
    const offset = performance.timeOrigin - (init.timeOrigin ?? performance.timeOrigin);
    const ctx = {
        config,
        urlParams: init.urlParams ?? {},
        ticksPerBeat: clock.ticksPerBeat,
        ticksPerMeasure: clock.ticksPerBeat * (clock.timeSignature?.numerator ?? 4),
        // the widgets' current values by kind and id, starting from their YAML values
        params: initialParams(config),
        // set when the microphone stream starts (audio mode)
        audio: null,
        // the agent's audio output (interactionMode.audioOut), set by the worker runtime
        audioOut: null,
        // the live canvas's shared state (gui.liveCanvas), set by the worker runtime
        liveCanvas: null,
        types: {noteType, playerType, instrumentType, messageType, statusType, uiParameterType},
        /** Seconds on the page's clock, the clock of user notes' createdAt.seconds. */
        now: () => (performance.now() + offset) / 1000,

        /**
         * A note for the agent to play.
         * @param {number} midi
         * @param {'on'|'off'|'hold'|number} [type='on']
         * @param {Object} [options]
         * @param {number} [options.velocity=127]
         * @param {'piano'|'drums'|'bass'|'synth'|number} [options.instrument='piano']
         * @param {number} [options.tick=0] - Play this many ticks from now (0: at once).
         * @param {number} [options.seconds=0] - Plus this many seconds.
         * @param {{tick: number, seconds: number}} [options.duration] - Euterpe sends the note-off itself.
         * @return {NoteEvent}
         */
        note(midi, type = 'on', {velocity = 127, instrument = 'piano', tick = 0, seconds = 0, duration = null} = {}) {
            const note = new NoteEvent();
            note.player = playerType.AGENT;
            note.instrument = typeof instrument === 'number' ? instrument : INSTRUMENTS[instrument];
            note.type = typeof type === 'number' ? type : NOTE_TYPES[type];
            if (note.instrument === undefined) throw new Error(`ctx.note: unknown instrument "${instrument}"`);
            if (note.type === undefined) throw new Error(`ctx.note: unknown note type "${type}"`);
            note.midi = midi;
            note.velocity = velocity;
            note.playAfter = {tick, seconds};
            note.duration = duration;
            return note;
        },
        noteOn: (midi, options) => ctx.note(midi, 'on', options),
        noteOff: (midi, options) => ctx.note(midi, 'off', options),

        /**
         * Sends output to the UI outside a hook's return value (e.g. progress while loading a model).
         * @param {Object|Array} output - As a hook would return it.
         */
        send(output) {
            const message = toMessage(output, 'ctx.send', ctx);
            if (message) postMessage({hookType: ctx._loading ? agentHookType.INIT_AGENT : agentHookType.NOTE_EVENT, message});
        },
        /**
         * Shows a value in the Monitor widget (gui.monitor in widgets.yaml).
         * @param {number} id
         * @param {number} value
         */
        monitor(id, value) {
            self.param_writer?.enqueue_change(id, value);
        },
        _loading: true,
    };
    return ctx;
}

function initialParams(config) {
    const modal = config.gui?.settingsModal ?? {};
    const params = {slider: {}, switch: {}, button: {}, dropdown: {}, text: {}};
    // by YAML id (sliders and switches without one: their position)
    (modal.sliders ?? []).forEach((s, i) => params.slider[s.id ?? i + 1] = s.value);
    (modal.switches ?? []).forEach((s, i) => params.switch[s.id ?? i + 1] = Boolean(s.status));
    (modal.dropdowns ?? []).forEach((d) => params.dropdown[d.id] = d.value ?? 0);
    (modal.buttons ?? []).forEach((b) => params.button[b.id] = 0);
    (modal.textFields ?? []).forEach((f) => params.text[f.id] = f.value ?? '');
    return params;
}

/**
 * Records a widget change in ctx.params.
 * @param {Object} ctx
 * @param {{index: number, value: number}} update - From the UI's parameter ring buffer.
 * @return {{kind: string, id: number, value: number|boolean, index: number}}
 */
export function applyParameter(ctx, update) {
    const widget = WIDGETS[update.index] ?? {kind: 'unknown', id: update.index};
    let value = update.value;
    if (widget.kind === 'switch') value = value > 0.5;
    if (widget.kind === 'button') value = (ctx.params.button[widget.id] ?? 0) + 1; // presses so far
    if (ctx.params[widget.kind]) ctx.params[widget.kind][widget.id] = value;
    return {...widget, value, index: update.index};
}

// each distinct problem is reported once (hooks run on every tick)
const reported = new Set();
function warnOnce(text) {
    if (reported.has(text)) return;
    reported.add(text);
    console.warn(`[euterpe] ${text}`);
}

/**
 * Checks the notes a hook returned, and turns plain {midi, type, ...} objects into NoteEvents.
 * @param {Array} notes
 * @param {string} hookName
 * @param {Object} ctx
 * @return {NoteEvent[]}
 */
function checkNotes(notes, hookName, ctx) {
    if (!Array.isArray(notes)) {
        warnOnce(`${hookName}: notes must be an array, got ${typeof notes}`);
        return [];
    }
    const out = [];
    notes.forEach((note, i) => {
        if (!(note instanceof NoteEvent)) {
            if (note && typeof note === 'object' && 'midi' in note) {
                const {midi, type = 'on', ...options} = note;
                note = ctx.note(midi, type, options);
            } else {
                warnOnce(`${hookName}: notes[${i}] is not a note (use ctx.noteOn(midi) / ctx.noteOff(midi)); dropped`);
                return;
            }
        }
        if (!Number.isInteger(note.midi) || note.midi < 0 || note.midi > 127) {
            warnOnce(`${hookName}: a note has midi ${JSON.stringify(note.midi)}; it must be an integer 0-127; dropped`);
            return;
        }
        if (![noteType.NOTE_ON, noteType.NOTE_OFF, noteType.NOTE_HOLD].includes(note.type)) {
            warnOnce(`${hookName}: a note has type ${JSON.stringify(note.type)}; use 'on', 'off' or 'hold'; dropped`);
            return;
        }
        const after = note.playAfter ?? {};
        if (!(after.tick >= 0) || !(after.seconds >= 0)) {
            warnOnce(`${hookName}: a note has playAfter ${JSON.stringify(after)}; tick and seconds must be >= 0; ` +
                'set to play at once');
            note.playAfter = {tick: Math.max(0, after.tick || 0), seconds: Math.max(0, after.seconds || 0)};
        }
        if (note.player === undefined || note.player === null) note.player = playerType.AGENT;
        if (note.instrument === undefined || note.instrument === null) note.instrument = instrumentType.PIANO;
        out.push(note);
    });
    return out;
}

/**
 * A hook's return value as an MICP message: an array of notes, an object keyed by name ({notes, text, ...}) or
 * by messageType number (the original protocol), or nothing. The notes are checked (checkNotes).
 * @param {*} output
 * @param {string} hookName - For the warnings.
 * @param {Object} [ctx]
 * @return {Object|undefined}
 */
export function toMessage(output, hookName, ctx) {
    if (output === undefined || output === null) return undefined;
    if (Array.isArray(output)) output = {notes: output};
    if (output instanceof Float32Array) output = {audio: output};
    if (typeof output !== 'object') {
        warnOnce(`${hookName} returned ${typeof output}; return an array of notes or {notes, text, label, ...}`);
        return undefined;
    }
    const message = {};
    for (const [key, value] of Object.entries(output)) {
        if (key === 'audio') {
            // audio goes to the output ring buffer, not to the UI
            if (ctx?.audioOut) ctx.audioOut.write(value);
            else warnOnce(`${hookName} returned audio, but config.yaml has no interactionMode.audioOut: true`);
        } else if (/^\d+$/.test(key)) {
            message[key] = value;
        } else if (key in MESSAGE_KEYS) {
            message[MESSAGE_KEYS[key]] = value;
        } else {
            warnOnce(`${hookName} returned an unknown key "${key}" (known: ${Object.keys(MESSAGE_KEYS).join(', ')})`);
        }
    }
    if (ctx && message[messageType.NOTE_LIST] !== undefined) {
        message[messageType.NOTE_LIST] = checkNotes(message[messageType.NOTE_LIST], hookName, ctx);
    }
    return message;
}

export {warnOnce};
