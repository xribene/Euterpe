/**
 * The agent's Web Worker: Euterpe's side of the worker protocol (MICP). It receives the config, the clock and
 * note events and the microphone audio from the main thread and calls the project's hooks, which it imports
 * from virtual:euterpe-agent (the project's agent/hooks.js, see euterpe/vite).
 */
import * as agentModule from 'virtual:euterpe-agent';
import {AGENT_MARK, HOOK_NAMES} from '../agent.js';
import {createContext, applyParameter, toMessage, warnOnce} from './context.js';
import {createAudioOut, startRenderLoop, disableAudioOut} from './audioOut.js';
import {createFramer} from './audioIn.js';
import {liveCanvasState} from '../utils/liveCanvasState.js';

// agent/hooks.js exports the hooks either as `export default defineAgent({...})` (the hooks get `ctx` and the
// runtime reports when the agent is ready) or, as the original agents do, as named functions using self.*
// (virtual:euterpe-agent's default export is the namespace of agent/hooks.js)
const hooksModule = agentModule.default;
const agent = hooksModule.default ?? hooksModule;
const defined = agent[AGENT_MARK] === true;
if (![...HOOK_NAMES, 'loadExternalFiles'].some((name) => typeof agent[name] === 'function')) {
    console.warn('[euterpe] agent/hooks.js defines no hooks: expected `export default defineAgent({...})`');
}
// the ctx passed to defineAgent hooks (created with the config)
let ctx = null;
// the renderAudio loop's interval, if running
let renderLoop = null;
// widget changes made while loadAlgorithm runs, for updateParameter once it has finished
const pendingChanges = [];
const missing = (name) => () => console.warn(`agent/hooks.js does not define ${name}()`);
const hook = (name, fallback) => (typeof agent[name] === 'function' ? agent[name] : fallback ?? missing(name));
const loadExternalFiles = hook('loadExternalFiles', () => undefined);
// without a loadAlgorithm the agent is ready at once
const loadAlgorithm = hook('loadAlgorithm', () => postMessage({
    hookType: self.agentHookType.INIT_AGENT,
    message: {[self.messageType.STATUS]: self.statusType.SUCCESS},
}));
const updateParameter = hook('updateParameter', () => undefined);
const processClockEvent = hook('processClockEvent', () => ({}));
const processNoteEvent = hook('processNoteEvent', () => undefined);
const processAudioBuffer = hook('processAudioBuffer', () => undefined);

import {LIFOQueue} from '../utils/dataStructures.js';
import {NoteEvent} from '../utils/NoteEvent.js';

import {
    AudioReader,
    ParameterReader,
    ParameterWriter,
    RingBuffer,
} from 'ringbuf.js';
// Global variables shared between the agent.js and the hooks
// need to be declared using the self keyword
// Local variables can be declared using the let keyword (or const)
self.config = null;
self.playerType = null;
self.instrumentType = null;
self.messageType = null;
self.statusType = null;
self.noteType = null;
self.parameterType = null;
self.agentHookType = null;

// Audio related variables
self.channelCount = null;
self.sampleRate = null;
self.audio_frames_queue = null;
self.audio_features_queue = null;
self.windowSize = null;
self.hopSize = null;

let staging = null;
let _audioReader = null;
let framesPerTick = null;
// the microphone's frames (audioIn.js), and when its first sample was captured (page clock seconds), once known
let framer = null;
let audioInStart = null;
let stagingIntervalID = null;
let uiParameterIntervalID = null;
// Clock events are processed in order, one at a time (see onMessageFunction)
let clockQueue = Promise.resolve();
// and note events too
let noteQueue = Promise.resolve();

self.param_reader = null;
self.param_writer = null;

/*
    This is a dictionary that maps the midi numbers of the notes
    the user played, to the notes the agent responded for that
    particular note.
    Then, when the agent receives a note-off event, it can use
    this dictionary to know which note(s) to turn off.
    To be used by the processNoteEvent() hook.
    An example of how to use it can be found
    in src/agent-examples/pianoGenie/processNoteEvent_hook.js
    and src/agent-examples/copycat/processNoteEvent_hook.js
*/
self.userToAgentNoteMapping = {};

/**
 * Reads the microphone's samples from the ring buffer, cuts them into frames (audioIn.js) and passes each frame
 * to processAudioBuffer. A frame is an array of Float32Arrays (one per channel) with its position: `start`
 * (samples since the microphone started, at frame.sampleRate), `time` (when its first sample was captured, in
 * seconds on the page's clock, like ctx.now(); null until known) and `sampleRate`.
 * @return {number} The samples read.
 */
function _readFromQueue() {
    // at most what is queued now: a hook slower than real time must not keep the worker from its other work
    // (notes, widgets, the audio output); the backlog is read on the next calls
    let budget = _audioReader.available_read();
    let total = 0;
    while (budget > 0) {
        const samplesRead = _audioReader.dequeue(staging.subarray(0, Math.min(staging.length, budget)));
        if (!samplesRead) break;
        budget -= samplesRead;
        total += samplesRead;
        for (const {planes, start} of framer.push(staging.subarray(0, samplesRead))) {
            const frame = planes;
            frame.start = start;
            frame.sampleRate = ctx.audio.sampleRate;
            frame.time = audioInStart === null ? null :
                audioInStart + start / ctx.audio.sampleRate - framer.delay;
            if (defined) {
                // frames that arrive while loadAlgorithm runs are dropped: the agent isn't ready for them
                if (!ctx._loading) {
                    Promise.resolve(processAudioBuffer(frame, ctx)).then((output) => {
                        const message = toMessage(output, 'processAudioBuffer', ctx);
                        if (message) postMessage({hookType: self.agentHookType.NOTE_EVENT, message});
                    }).catch((error) => console.error('processAudioBuffer failed', error));
                }
            } else {
                processAudioBuffer(frame);
            }
        }
    }
    return total;
}

/**
 * Calls a defineAgent agent's updateParameter; what it returns (notes, text, audio) is sent like any hook's.
 * @param {Object} change
 * @return {Promise<void>}
 */
function runUpdateParameter(change) {
    return Promise.resolve(updateParameter(change, ctx)).then((output) => {
        const message = toMessage(output, 'updateParameter', ctx);
        if (message && Object.keys(message).length) postMessage({hookType: self.agentHookType.NOTE_EVENT, message});
    }).catch((error) => console.error('updateParameter failed', error));
}

/**
 * This function is called regularily to check if there are any
 * new parameters from the UI.
 */
function _uiParameterObserver() {
    const newParameterUI = {index: null, value: null};
    if (self.param_reader.dequeue_change(newParameterUI)) {
        console.debug('param index: ' + newParameterUI.index + ' value: ' + newParameterUI.value);
        const change = applyParameter(ctx, newParameterUI);
        if (defined) dispatchChange(change);
        else updateParameter(newParameterUI);
    }
}

/**
 * Passes a widget change (ctx.params already updated) to a defineAgent agent's updateParameter, or holds it
 * until loadAlgorithm has finished.
 * @param {Object} change
 */
function dispatchChange(change) {
    if (ctx._loading) pendingChanges.push(change);
    else runUpdateParameter(change);
}

/**
 *
 * @param {Object} content
 */
function initParameterSharing(content) {
    // Reads parameters from the UI (sliders, buttons, etc.)
    self.param_reader = new ParameterReader(
        new RingBuffer(content.sab_par_ui, Uint8Array),
    );
    // Writes parameters to the UI (e.g., rms, loudness, inference time, etc.)
    // The parameters need to be single float values
    self.param_writer = new ParameterWriter(
        new RingBuffer(content.sab_par_agent, Uint8Array),
    );
    uiParameterIntervalID = setInterval(_uiParameterObserver, 100);
}

/**
 *
 * @param {Object} content
 */
function loadConfig(content) {
    self.config = content.config;
    // the page's URL query (e.g. ?ortThreads=4, see ortEnv.js)
    self.urlParams = content.urlParams ?? {};
    self.playerType = content.playerType;
    self.instrumentType = content.instrumentType;
    self.noteType = content.noteType;
    self.statusType = content.statusType;
    self.messageType = content.messageType;
    self.uiParameterType = content.uiParameterType;
    self.agentHookType = content.agentHookType;
    self.ticksPerMeasure = self.config.clockSettings.ticksPerBeat *
                                self.config.clockSettings.timeSignature.numerator;
    console.debug('finished loading config');
}

/**
 * Hook that receives sharedArrayBuffers from the main UI
 * and creates readers/writers to read/write audio
 * data to them.
 * Audio related initializations also happen here.
 * @param {Object} content
 */
function initAudio(content) {
    _audioReader = new AudioReader(
        new RingBuffer(content.sab, Float32Array),
    );

    // the page's audio: interleaved, channelCount channels at the page's (AudioContext's) sample rate
    self.channelCount = content.channelCount;
    self.sampleRate = content.sampleRate;
    const settings = {windowSize: 1024, ...self.config.audioModeSettings};
    // the hop defaults to the window (no overlap) and can't exceed it
    settings.hopSize = Math.min(settings.hopSize ?? settings.windowSize, settings.windowSize);
    // the agent's frames: at audioModeSettings.sampleRate (resampled) or the page's rate
    const sampleRate = settings.sampleRate ?? self.sampleRate;
    ctx.audio = {sampleRate, channelCount: self.channelCount, windowSize: settings.windowSize,
        hopSize: settings.hopSize, pageSampleRate: self.sampleRate};
    framer = createFramer({channels: self.channelCount, inRate: self.sampleRate, outRate: sampleRate,
        windowSize: settings.windowSize, hopSize: settings.hopSize});

    // (for agents written the original way: sizes in interleaved samples, and the frame queues)
    self.windowSize = settings.windowSize * self.channelCount;
    self.hopSize = settings.hopSize * self.channelCount;
    framesPerTick = self.sampleRate * self.channelCount / self.hopSize / self.config.clockSettings.ticksPerBeat;
    self.audio_frames_queue = new LIFOQueue(16 * framesPerTick);
    self.audio_features_queue = new LIFOQueue(16 * framesPerTick);

    // each read takes everything the ring buffer holds (up to 8192 samples per dequeue)
    staging = new Float32Array(8192);
    stagingIntervalID = setInterval(_readFromQueue, 10);
    console.debug('finished setting up audio');
}

/**
 * Hook selector based on the MICP packet type
 * @param {Object} obj
 */
async function onMessageFunction(obj) {
    // control messages from the page (not hooks)
    if (obj.data?.control === 'audioOutUnavailable') {
        disableAudioOut(ctx?.audioOut ?? null, renderLoop);
        return;
    }
    if (obj.data?.control === 'textField') {
        // a text field (settingsModal.textFields): ctx.params.text[id], then updateParameter (defineAgent agents)
        const {id, value} = obj.data;
        if (!ctx) return;
        ctx.params.text[id] = value;
        if (defined) dispatchChange({kind: 'text', id, value});
        return;
    }
    if (obj.data?.control === 'audioInStart') {
        audioInStart = obj.data.time;
        return;
    }
    if (obj.data?.control === 'audioInGap') {
        framer?.gap(obj.data.frames);
        warnOnce('the microphone input fell behind and some audio was dropped (processAudioBuffer slower than ' +
            'real time?); frame.start / frame.time skip the gap');
        return;
    }
    if (obj.data?.control === 'audioOutQuantum') {
        if (ctx?.audioOut) ctx.audioOut.quantum = obj.data.frames;
        return;
    }
    if (self.config == null) {
        await initAgent(obj.data.content);
        // make sure that the config is loaded
        if (self.config == null) {
            console.error('Agent not initialized correctly. Failed to load config');
            return;
        } else {
            console.debug('Agent is initialized');
            return;
        }
    } else {
        if (obj.data.hookType == self.agentHookType.CLOCK_EVENT) {
            // The NoteEvents we receive from the UI are serialized
            // We need to deserialize them
            const content = obj.data.content;
            if (defined) {
                // empty unless gridBased.eventBuffer / quantizedEvents are on (config.yaml)
                content.userNotes ??= [];
                content.userQuantizedNotes ??= [];
            }
            if (content.userNotes) {
                content.userNotes =
                            content.userNotes.map(
                                (serializedNoteEvent) => NoteEvent.fromPlain(serializedNoteEvent));
            }
            if (content.userQuantizedNotes) {
                content.userQuantizedNotes =
                            content.userQuantizedNotes.map(
                                (serializedNoteEvent) => NoteEvent.fromPlain(serializedNoteEvent));
            }
            // processClockEvent is async (the ONNX transformer's inference is); ticks are handled one at a
            // time and in order, so a tick never sees BachDuet's state half-way through the previous one
            clockQueue = clockQueue.then(async () => {
                const startTime = performance.now();
                let message = defined ?
                    toMessage(await processClockEvent(content, ctx), 'processClockEvent', ctx) :
                    await processClockEvent(content);
                const endTime = performance.now();
                if (typeof message === 'undefined') {
                    message = {};
                }
                message[self.messageType.INFERENCE_TIME] = endTime - startTime;
                message[self.messageType.CLOCK_TIME] = content.tick;
                postMessage({
                    hookType: self.agentHookType.CLOCK_EVENT, // Do not modify
                    message: message,
                });
            }).catch((error) => console.error('Clock event failed', error));
        } else if (obj.data.hookType == self.agentHookType.NOTE_EVENT) {
            // The NoteEvents we receive from the UI are serialized
            // We need to deserialize them
            const noteEvent = NoteEvent.fromPlain(obj.data.content);
            // a defineAgent agent still loading isn't ready for notes: they are dropped
            if (defined && ctx._loading) return;
            noteQueue = noteQueue.then(async () => {
                const message = defined ?
                    toMessage(await processNoteEvent(noteEvent, ctx), 'processNoteEvent', ctx) :
                    await processNoteEvent(noteEvent);
                if (typeof message !== 'undefined') {
                    postMessage({
                        hookType: self.agentHookType.NOTE_EVENT,
                        message: message,
                    });
                }
            }).catch((error) => console.error('processNoteEvent failed', error));
        }
    }
    return;
}

/**
 * Hook that takes the necessary configuration data from the main thread
 * @param {Object} content
 */
async function initAgent(content) {
    console.debug('inside initAgent');
    try {
        loadConfig(content);
        ctx = createContext(content);
        // the live canvas (gui.liveCanvas): its state, read directly at every tick (ctx.liveCanvas, self.liveCanvas)
        if (content.sabLiveCanvas) ctx.liveCanvas = self.liveCanvas = liveCanvasState(content.sabLiveCanvas);
        // the agent's audio output (config.yaml interactionMode.audioOut): ctx.audioOut, self.audioOut
        if (content.sabAudioOut) {
            ctx.audioOut = createAudioOut(content.sabAudioOut, {
                ...content.audioOut,
                // the agent's rate (audioOutSettings.sampleRate) or the page's
                sampleRate: content.audioOut.sampleRate ?? content.sampleRate,
                pageSampleRate: content.sampleRate,
            }, warnOnce, () => ctx.now());
            self.audioOut = ctx.audioOut;
        }
        if (defined) {
            initAudio(content);
            initParameterSharing(content);
            await loadDefinedAgent();
        } else {
            const externalFilesLoaded = loadExternalFiles();
            loadAlgorithm(externalFilesLoaded);
            initAudio(content);
            initParameterSharing(content);
        }
        console.debug('Initialization complete');
    } catch (error) {
        console.error('Error initializing worker:', error);
        postMessage({
            hookType: self.agentHookType?.INIT_AGENT ?? 2,
            message: {
                [self.messageType?.STATUS ?? 0]: self.statusType?.ERROR ?? 3,
                [self.messageType?.TEXT ?? 13]: `Euterpe could not start the agent: ${error?.message ?? error}`,
            },
        });
    }
}

/**
 * Runs a defineAgent agent's loadAlgorithm and tells the UI when it is ready, or why it failed.
 */
async function loadDefinedAgent() {
    try {
        if (typeof agent.loadAlgorithm === 'function') await agent.loadAlgorithm(ctx);
        ctx._loading = false;
        for (const change of pendingChanges.splice(0)) await runUpdateParameter(change);
        if (typeof agent.renderAudio === 'function') {
            if (ctx.audioOut) {
                renderLoop = startRenderLoop(agent.renderAudio, ctx, (error) => console.error('renderAudio failed', error));
            } else {
                warnOnce('agent/hooks.js defines renderAudio, but config.yaml has no interactionMode.audioOut: true');
            }
        }
        postMessage({
            hookType: self.agentHookType.INIT_AGENT,
            message: {
                [self.messageType.STATUS]: self.statusType.SUCCESS,
                [self.messageType.TEXT]: 'The Agent is ready to interact with you!',
            },
        });
    } catch (error) {
        console.error('loadAlgorithm failed', error);
        postMessage({
            hookType: self.agentHookType.INIT_AGENT,
            message: {
                [self.messageType.STATUS]: self.statusType.ERROR,
                [self.messageType.TEXT]: `The agent failed to load: ${error?.message ?? error}`,
            },
        });
    }
}

self.onmessage = onMessageFunction;
