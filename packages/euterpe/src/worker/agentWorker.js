/**
 * The agent's Web Worker: Euterpe's side of the worker protocol (MICP). It receives the config, the clock and
 * note events and the microphone audio from the main thread and calls the project's hooks, which it imports
 * from virtual:euterpe-agent (the project's agent/hooks.js, see euterpe/vite).
 */
import * as agentModule from 'virtual:euterpe-agent';
import {AGENT_MARK, HOOK_NAMES} from '../agent.js';
import {createContext, applyParameter, toMessage, warnOnce} from './context.js';
import {createAudioOut, startRenderLoop} from './audioOut.js';

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

import {deinterleaveCustom} from '../utils/helpers.js';
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
let sampleCounter = null;
let currentFrame = null;
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
 * Read some audio samples from queue, and process them
 * Here we create audio_frames based on windowSize and hopSize
 * and we send them for processing in the processAudioBuffer() hook
 * @return {number} - The number of samples read from the queue
 */
function _readFromQueue() {
    const samplesRead = _audioReader.dequeue(staging);

    if (!samplesRead) {
        return 0;
    }

    // samplesRead can have less length than staging
    for (let i = 0; i < samplesRead; i++) {
        if (sampleCounter == self.windowSize - 1) {
            // Here you can do some analysis on the current audio frame
            const channel1 = new Float32Array(currentFrame.length / self.channelCount);
            const channel2 = new Float32Array(currentFrame.length / self.channelCount);
            const channels = [channel1, channel2];
            // console.debug("in read from queue");
            deinterleaveCustom(currentFrame, channels, self.channelCount);
            const tempFrame = new Float32Array(self.windowSize);
            // Copy the last windowSize - hopSize samples to the current frame
            // to the beginning of the new frame
            for (let j = 0; j < (self.windowSize - self.hopSize); j++) {
                tempFrame[j] = currentFrame[j + self.hopSize];
            }
            currentFrame = tempFrame;
            sampleCounter = self.windowSize - self.hopSize;

            if (defined) {
                // frames that arrive while loadAlgorithm runs are dropped: the agent isn't ready for them
                if (!ctx._loading) {
                    Promise.resolve(processAudioBuffer(channels, ctx)).then((output) => {
                        const message = toMessage(output, 'processAudioBuffer', ctx);
                        if (message) postMessage({hookType: self.agentHookType.NOTE_EVENT, message});
                    }).catch((error) => console.error('processAudioBuffer failed', error));
                }
            } else {
                processAudioBuffer(channels);
            }
        }
        currentFrame[sampleCounter] = staging[i];
        sampleCounter += 1;
    }
    return samplesRead;
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
        if (defined && ctx._loading) {
            // ctx.params has the new value already; the hook runs once loadAlgorithm has finished
            pendingChanges.push(change);
        } else if (defined) {
            Promise.resolve(updateParameter(change, ctx)).catch((error) => console.error('updateParameter failed', error));
        } else {
            updateParameter(newParameterUI);
        }
    }
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
    // console.debug(content)
    // Reads audio samples directly from the microphone
    _audioReader = new AudioReader(
        new RingBuffer(content.sab, Float32Array),
    );

    // The number of channels of the audio stream read from the queue.
    self.channelCount = content.channelCount;
    // The sample-rate of the audio stream read from the queue.
    self.sampleRate = content.sampleRate;
    ctx.audio = {sampleRate: self.sampleRate, channelCount: self.channelCount};

    // The frame/window size
    // (audioModeSettings is optional: 1024 / 1024 by default)
    const audioSettings = {windowSize: 1024, hopSize: 1024, ...self.config.audioModeSettings};
    self.windowSize = audioSettings.windowSize * self.channelCount;

    // The hop size
    self.hopSize = audioSettings.hopSize * self.channelCount;

    // Audio Frames per clock tick
    framesPerTick = self.sampleRate * self.channelCount * 60 /
                            60 / // self.config.clockSettings.tempo
                            self.hopSize /
                            self.config.clockSettings.ticksPerBeat;

    /*
        Store the audio data, as an array of frames
        each frame is as array of float32 samples.
        the size of the frame is equal to windowSize
        This will be used in the AUDIO_BUFFER hook to
        to feed the audio frames to the worker's music interaction algorithm.
        We use a LIFOQueue to store the frames, so that we can efficiently
        push and pop frames from the queue.
        We set the max size of the queue to the equivalent duration of 16 clock ticks
    */
    self.audio_frames_queue = new LIFOQueue(16 * framesPerTick);

    // Same for the audio features queue. These features are extracted
    // from the audio frames.
    self.audio_features_queue = new LIFOQueue(16 * framesPerTick);

    // The current frame/window array. We'll keep pushing samples to it
    // untill it's full (windowSize samples). Then we'll push it to the
    // audio_frames_queue and start a new frame/window.
    currentFrame = new Float32Array(self.windowSize);

    // This counter will be used to keep track of the number of samples
    // we have pushed to the current frame/window.
    sampleCounter = 0;

    /*
    // A smaller staging array to copy the audio samples from, before conversion
    // to uint16. It's size is 4 times less than the 1 second worth of data
    // that the ring buffer can hold, so it's 250ms, allowing to not make
    // deadlines:
    */
    staging = new Float32Array(self.hopSize);

    // Meyda.bufferSize = self.config.audioModeSettings.windowSize;
    // console.debug(self.windowSize, " ", self.Meyda.bufferSize);
    stagingIntervalID = setInterval(_readFromQueue, 10);
    console.debug('finished setting up audio');
}

/**
 * Hook selector based on the MICP packet type
 * @param {Object} obj
 */
async function onMessageFunction(obj) {
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
        // the agent's audio output (config.yaml interactionMode.audioOut): ctx.audioOut, self.audioOut
        if (content.sabAudioOut) {
            ctx.audioOut = createAudioOut(content.sabAudioOut,
                {...content.audioOut, sampleRate: content.sampleRate}, warnOnce);
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
        for (const change of pendingChanges.splice(0)) {
            await Promise.resolve(updateParameter(change, ctx)).catch((error) => console.error('updateParameter failed', error));
        }
        if (typeof agent.renderAudio === 'function') {
            if (ctx.audioOut) {
                startRenderLoop(agent.renderAudio, ctx, (error) => console.error('renderAudio failed', error));
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
