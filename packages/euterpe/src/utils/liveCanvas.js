/**
 * The live canvas on the page (gui.liveCanvas): the user draws a line with the mouse (drawing mode, pointer lock)
 * and taps a key for rhythm; the agent turns the line into the user's voice (see apps/bachduet/agent/
 * liveCanvasVoice.js) and sends, after each tick t, the user's note for t+1 (messageType.HUMAN_TOKEN).
 *
 * This controller plays that note as the user's note at tick t+1, through processUserNoteEvent (eventSource
 * CANVAS), before the quantizer runs for t+1: the score, the piano roll, the audio and the agent treat it like
 * keyboard input. A tap plays the latest onset candidate at once (like a MIDI key) and holds it while the key is
 * down. LiveCanvas.vue draws it all.
 */
import {Midi} from '@tonaljs/tonal';
import {NoteEvent} from './NoteEvent.js';
import {liveCanvasState} from './liveCanvasState.js';

export const LIVE_CANVAS_DEFAULTS = {
    status: false,
    // mouse pixels per semitone (vertical movement only)
    sensitivity: 20,
    // the line's range, in semitones (the canvas shows 24)
    range: [0, 24],
    // the key held for rhythm (not Space, which starts and stops the clock)
    tapKey: 'f',
    // on key release: 'model' - the model's rhythm takes over (the note goes on until it says otherwise),
    // 'off' - the note stops
    tapRelease: 'model',
    // drawing mode off: 'hold' the note, 'rest', or 'free' (the model plays on without the curve)
    penUp: 'hold',
    // 'rules' | 'onnx'
    model: 'rules',
    // the canvas voice plays from the start (the switch next to the canvas turns it off)
    armed: true,
    // the canvas's size in pixels
    width: 640,
    height: 240,
    // ticks of the past shown left of the "now" marker
    ticksShown: 48,
    // rules: the MIDI note at height 0, onsets on multiples of `density` ticks
    baseMidi: 60,
    density: 2,
};

/**
 * @param {Object} vm - The Euterpe view.
 * @param {Object} options - gui.liveCanvas
 */
export class LiveCanvasController {
    constructor(vm, options) {
        this.vm = vm;
        this.options = {...LIVE_CANVAS_DEFAULTS, ...options};
        this.shared = liveCanvasState();
        this.sab = this.shared.sab;
        const [lo, hi] = this.options.range;
        this.shared.height = (lo + hi) / 2;
        this.shared.model = this.options.model;
        this.shared.armed = this.options.armed;
        // HUMAN_TOKEN payloads by tick, until their tick comes
        this.pending = new Map();
        // the canvas voice's note sounding now (MIDI), or null
        this.current = null;
        // the latest onset candidate (the pitch a tap plays)
        this.candidate = null;
        this.tapNote = null;
        // a tick whose token hadn't arrived when the tick came (the token is played if it arrives before the
        // quantizer runs for that tick)
        this.awaiting = null;
        // for drawing: the tick times, the line, and the notes of both voices
        this.lastTick = null;
        this.points = [];
        this.userNotes = [];
        this.agentNotes = [];
        this.lastPayload = null;
        this.stats = {tokens: 0, played: 0, late: 0, missing: 0, taps: 0, ms: [], modelShown: this.options.model};
        this.wasRunning = false;
        this._onKey = this._onKey.bind(this);
        window.addEventListener('keydown', this._onKey, true);
        window.addEventListener('keyup', this._onKey, true);
    }

    get running() {
        return Boolean(this.vm.$store.getters.getClockStatus);
    }

    get tickMs() {
        return this.vm.config.clockSettings.clockPeriod ??
            60000 / this.vm.localBPM / this.vm.$store.getters.getTicksPerBeat;
    }

    // ---- what the widget and the test hook change ----

    setArmed(on) {
        this.shared.armed = Boolean(on);
        if (!on) this._release();
    }

    setPen(on) {
        this.shared.pen = Boolean(on);
    }

    setModel(name) {
        this.shared.model = name;
    }

    setHeight(semitones) {
        const [lo, hi] = this.options.range;
        this.shared.height = Math.min(hi, Math.max(lo, semitones));
    }

    /** Vertical mouse movement in drawing mode (pixels; up is negative, as movementY). */
    move(dy) {
        this.setHeight(this.shared.height - dy / this.options.sensitivity);
    }

    // ---- the clock and the agent ----

    /**
     * At every tick (Euterpe.vue tickBehavior), right after the tick number changed and before the quantizer:
     * plays the user's note for this tick.
     * @param {number} tick - the global tick
     */
    onTick(tick) {
        this.lastTick = {tick, local: this.vm.$store.getters.getLocalTick, time: performance.now()};
        this.wasRunning = true;
        for (const t of this.pending.keys()) if (t < tick) this.pending.delete(t);
        const payload = this.pending.get(tick);
        if (payload) {
            this.pending.delete(tick);
            this._play(payload);
        } else if (this.shared.armed) {
            // not here yet: played if it arrives before the quantizer runs for this tick, else the note goes on
            this.awaiting = tick;
        }
    }

    /**
     * A HUMAN_TOKEN from the agent.
     * @param {{tick: number, midi: number, artic: number, candidate: number}} payload
     */
    onHumanToken(payload) {
        this.stats.tokens++;
        this.lastPayload = payload;
        if (typeof payload.ms === 'number') {
            this.stats.ms.push(payload.ms);
            if (this.stats.ms.length > 400) this.stats.ms.splice(0, 200);
        }
        if (payload.candidate) this.candidate = payload.candidate;
        if (payload.model) this.stats.modelShown = payload.model;
        if (this.awaiting === payload.tick) {
            this.awaiting = null;
            // the quantizer for that tick hasn't run yet (it increments the delayed tick)
            if (this.vm.$store.getters.getGlobalTickDelayed < payload.tick) {
                this.stats.late++;
                this._play(payload);
            } else {
                this.stats.missing++;
            }
            return;
        }
        const now = this.vm.$store.getters.getGlobalTick;
        if (payload.tick > now) this.pending.set(payload.tick, payload);
        else this.stats.missing++;
    }

    _play(payload) {
        // BachDuet's note at this tick, for the drawing
        if (payload.bass) this._trackAgent(payload.bass);
        // while the tap key is down the tap's note sounds
        if (this.shared.keyHeld || !this.shared.armed || !this.running) return;
        this.stats.played++;
        if (payload.artic === 1 && payload.midi > 0) {
            this._noteOff();
            this._noteOn(payload.midi);
        } else if (!payload.midi) {
            this._noteOff();
        }
        // a hold: the note goes on (if none sounds, there is nothing to hold)
    }

    // ---- taps ----

    _onKey(e) {
        if (!this.vm.config.gui?.liveCanvas?.status) return;
        if ((e.key ?? '').toLowerCase() !== String(this.options.tapKey).toLowerCase()) return;
        const target = e.target;
        if (target && (target.tagName === 'INPUT' || target.tagName === 'SELECT' || target.tagName === 'TEXTAREA')) {
            return;
        }
        // the tap key is the canvas's: AudioKeys must not play it
        e.stopImmediatePropagation();
        e.preventDefault();
        if (e.type === 'keydown' && !e.repeat) this.tapDown();
        else if (e.type === 'keyup') this.tapUp();
    }

    /** The tap key went down: the onset candidate sounds at once. */
    tapDown() {
        if (this.shared.keyHeld) return;
        this.shared.keyHeld = true;
        if (!this.running || !this.shared.armed) return;
        this.stats.taps++;
        const [lo] = this.options.range;
        const pitch = this.candidate ?? this.current ??
            Math.round(this.options.baseMidi + this.shared.height - lo);
        this._noteOff();
        this._noteOn(pitch);
        this.tapNote = pitch;
    }

    /** The tap key went up: the model's rhythm takes over again (or the note stops, tapRelease: 'off'). */
    tapUp() {
        if (!this.shared.keyHeld) return;
        this.shared.keyHeld = false;
        if (this.options.tapRelease === 'off') this._noteOff();
        this.tapNote = null;
    }

    // ---- notes ----

    _note(midi, type) {
        const vm = this.vm;
        const note = new NoteEvent();
        note.player = vm.playerType.HUMAN;
        note.instrument = vm.instrumentType.PIANO;
        note.eventSource = vm.eventSourceType.CANVAS;
        note.name = Midi.midiToNoteName(midi, {sharps: true});
        note.type = type;
        note.channel = 140;
        note.midi = midi;
        note.velocity = 110;
        note.createdAt = {seconds: performance.now() / 1000, tick: vm.$store.getters.getGlobalTickDelayed};
        note.playAfter = {seconds: 0, tick: 0};
        note.duration = null;
        vm.processUserNoteEvent(note);
    }

    _noteOn(midi) {
        midi = Math.min(108, Math.max(21, midi));
        this._note(midi, this.vm.noteType.NOTE_ON);
        this.current = midi;
        this.userNotes.push({midi, start: performance.now(), end: null});
        this._trim(this.userNotes);
    }

    _noteOff() {
        if (this.current === null) return;
        this._note(this.current, this.vm.noteType.NOTE_OFF);
        const last = this.userNotes[this.userNotes.length - 1];
        if (last && last.end === null) last.end = performance.now();
        this.current = null;
    }

    _release() {
        this._noteOff();
        this.tapNote = null;
    }

    _trackAgent({midi, artic}) {
        const now = performance.now();
        const last = this.agentNotes[this.agentNotes.length - 1];
        const open = last && last.end === null ? last : null;
        if (!midi || artic === 1) {
            if (open) open.end = now;
            if (midi) this.agentNotes.push({midi, start: now, end: null});
        } else if (!open || open.midi !== midi) {
            if (open) open.end = now;
            this.agentNotes.push({midi, start: now, end: null});
        }
        this._trim(this.agentNotes);
    }

    _trim(list) {
        if (list.length > 300) list.splice(0, list.length - 300);
    }

    /**
     * Called on every animation frame by the widget: records the line, and ends the canvas's note when the clock
     * stops.
     */
    frame() {
        const now = performance.now();
        this.points.push({time: now, h: this.shared.height, pen: this.shared.pen});
        const keepMs = (this.options.ticksShown + 4) * this.tickMs;
        while (this.points.length > 2 && this.points[0].time < now - keepMs) this.points.shift();
        if (this.wasRunning && !this.running) {
            this.wasRunning = false;
            this.pending.clear();
            this.awaiting = null;
            this._release();
            for (const list of [this.userNotes, this.agentNotes]) {
                const last = list[list.length - 1];
                if (last && last.end === null) last.end = now;
            }
        }
    }

    /** window.__euterpe.liveCanvas: drive the canvas from tests and scripts. */
    installTestHook() {
        if (!window.__euterpe) return;
        const c = this;
        window.__euterpe.liveCanvas = {
            setArmed: (on) => c.setArmed(on),
            setPen: (on) => c.setPen(on),
            setHeight: (h) => c.setHeight(h),
            move: (dy) => c.move(dy),
            setModel: (name) => c.setModel(name),
            tapDown: () => c.tapDown(),
            tapUp: () => c.tapUp(),
            get state() {
                return {...c.shared.read(), current: c.current, candidate: c.candidate};
            },
            get stats() {
                const ms = [...c.stats.ms].sort((a, b) => a - b);
                return {...c.stats, ms: undefined, msMedian: ms[ms.length >> 1] ?? null,
                    msMax: ms[ms.length - 1] ?? null, last: c.lastPayload};
            },
            get userNotes() {
                return c.userNotes.map((n) => ({...n}));
            },
        };
    }

    destroy() {
        window.removeEventListener('keydown', this._onKey, true);
        window.removeEventListener('keyup', this._onKey, true);
    }
}
