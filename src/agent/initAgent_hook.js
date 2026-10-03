/* eslint-disable require-jsdoc */
import {getThreadsCount} from '@tensorflow/tfjs-backend-wasm';
import {resetBachDuetState} from './bachDuetUtils.js';
import {parseTokens} from './bachDuetDecoding.js';

/**
 * Even though you can initialize variables outside of any function,
 * here we use initAgentVariables() to initialize variables that are
 * dependent information that exist on an external json file.
 * Check the definition of loadExternalFiles(), to see how we
 * call initAgentVariables() after loading the json file.
 */
export function initAgentVariables() {
    console.log('just entered initAgentVariables');
    // GUI controlled parameters start at their defaults in config_widgets.yaml (the UI only
    // sends a value once the user changes it). ??= keeps a value the user already chose
    // while the agent was loading (the start selectors are on the loading screen).
    self.temperature ??= widgetValue('sliders', 1) ?? 25;
    self.anticipation ??= widgetValue('sliders', 2) ?? 0;
    self.restBias ??= widgetValue('sliders', 3) ?? 0;
    self.startKey ??= dropdownOption(1, widgetValue('dropdowns', 1) ?? 0) ?? 'C major';
    self.startVoice ??= voiceFromOption(dropdownOption(2, widgetValue('dropdowns', 2) ?? 0));
    self.tokens = parseTokens(self.tokenIndexDict.midiArtic.index2token);

    // Other variables necessary for BachDuet
    const restMidi = 0;
    const restArtic = 1;
    const restCpc = 12;
    const restMidiArtic = restMidi.toString() + '_' + restArtic.toString();
    const restMidiArticInd = self.tokenIndexDict.midiArtic.token2index[restMidiArtic];
    // restNote needs to be accessed from processClockEvent_hook.js
    // so we need to declare it as a agent-global variable (using self)
    self.restNote = {midi: restMidi,
        artic: restArtic,
        midiArticInd: restMidiArticInd,
        cpc: restCpc};
    self.lastBachDuetNote = self.restNote;
}

// Current value of a widget in config_widgets.yaml (gui.settingsModal.<type>, by id)
function widgetValue(type, id) {
    return self.config.gui.settingsModal?.[type]?.find((w) => w.id === id)?.value;
}

function dropdownOption(id, index) {
    return self.config.gui.settingsModal?.dropdowns?.find((w) => w.id === id)?.options?.[index];
}

// 'I play the lower voice' -> 'lower', anything else -> 'upper'
function voiceFromOption(option) {
    return /lower/i.test(option ?? '') ? 'lower' : 'upper';
}

export function updateParameter(newUpdate) {
    switch (newUpdate.index) {
    case self.uiParameterType.SLIDER_1:
        self.temperature = newUpdate.value;
        break;
    case self.uiParameterType.SLIDER_2:
        self.anticipation = newUpdate.value;
        break;
    case self.uiParameterType.SLIDER_3:
        self.restBias = newUpdate.value;
        break;
    case self.uiParameterType.BUTTON_1:
        // button 1 is the reset button
        resetBachDuetState();
        break;
    case self.uiParameterType.DROPDOWN_1:
        // starting key: re-prime BachDuet for it (like Reset)
        self.startKey = dropdownOption(1, newUpdate.value) ?? self.startKey;
        resetBachDuetState();
        break;
    case self.uiParameterType.DROPDOWN_2:
        // starting voice of the user: re-prime BachDuet for it (like Reset)
        self.startVoice = voiceFromOption(dropdownOption(2, newUpdate.value));
        resetBachDuetState();
        break;
    default:
        console.warn('Invalid parameter type');
        break;
    }
}

export async function loadExternalFiles(content) {
    const [tokenIndexDict, primedIndex, primedData] = await Promise.all([
        fetch('/globalTokenIndexDict.json').then((response) => response.json()),
        fetch('/primedStates.json').then((response) => response.json()),
        fetch('/primedStates.bin').then((response) => response.arrayBuffer()),
    ]);
    self.tokenIndexDict = tokenIndexDict;
    console.log('just loaded tokenIndexDict');
    // LSTM states primed for each starting key and voice (see tools/primed-states)
    self.primedStates = {...primedIndex, data: new Float32Array(primedData)};
    initAgentVariables();
}

/**
 * Pick the first TF.js backend that works. WASM (multi-threaded when the page is
 * cross-origin isolated) is fastest for BachDuet's tiny per-tick inference and doesn't
 * need a GPU; WebGL is the fallback, plain JS (cpu) the last resort.
 */
async function selectBackend() {
    for (const backend of ['wasm', 'webgl', 'cpu']) {
        try {
            if (await tf.setBackend(backend)) {
                await tf.ready();
                const threads = backend === 'wasm' ? `, threads: ${getThreadsCount()}` : '';
                console.log(`TF.js ${tf.version.tfjs} backend: ${backend}${threads}` +
                    `, crossOriginIsolated: ${self.crossOriginIsolated}`);
                return backend;
            }
        } catch (error) {
            console.warn(`TF.js backend ${backend} failed`, error);
        }
    }
    throw new Error('No TF.js backend could be initialized');
}

export async function loadAlgorithm(externalFilesLoaded) {
    await selectBackend();
    try {
        self.modelLstm = await tf.loadLayersModel('/checkpoints/modelsFinal_Lstm/model.json');
        self.modelEmb = await tf.loadLayersModel('/checkpoints/modelsFinal_Emb/model_cleaned.json');
    } catch (error) {
        console.error(error);
    }
    postMessage({
        hookType: self.agentHookType.INIT_AGENT,
        message: {
            [self.messageType.STATUS]:
                    self.statusType.LOADED,
            [self.messageType.TEXT]:
                    'Core algorithm is loaded',
        },
    });

    // Warm up the model
    resetBachDuetState();
    const midiInp = tf.tensor2d([[96, 96]]);
    const cpcInp = tf.tensor2d([[12, 12]]);
    const rhyInp = tf.tensor2d([[4]]);
    const inferenceTimes = [];
    for (let i = 0; i < self.config.agentSettings.warmupRounds; i++) {
        const start = performance.now();
        tf.tidy(() => {
            const exodos = self.modelEmb.predict([midiInp, cpcInp, rhyInp]);
            const embMidi = exodos[0];
            const embCpc = exodos[1];
            const embRhy = exodos[2];
            const embMidiC = tf.concat([embMidi.slice([0, 0, 0], [1, 1, 150]),
                embMidi.slice([0, 1, 0], [1, 1, 150])], 2);
            const embCpcC = tf.concat([embCpc.slice([0, 0, 0], [1, 1, 150]),
                embCpc.slice([0, 1, 0], [1, 1, 150])], 2);
            const totalInp = tf.concat([embMidiC, embCpcC, embRhy], 2);
            const out = self.modelLstm.predict([totalInp, ...self.agentStates]);
            // wait for the result, so the warmup times are real
            out[0].dataSync();
        });

        const inferenceTime = performance.now() - start;
        inferenceTimes.push(inferenceTime);
        // console.log(inferenceTime);
        // you can sent WARMUP status messages to the UI if you want.
        // these will appear in the intro screen
        postMessage({
            hookType: self.agentHookType.INIT_AGENT,
            message: {
                [self.messageType.STATUS]:
                        self.statusType.WARMUP,
                [self.messageType.TEXT]:
                        'BachDuet is warming up. Current round: ' +
                        (i + 1) + '/' + self.config.agentSettings.warmupRounds,
            },
        });
    }
    tf.dispose([midiInp, cpcInp, rhyInp]);
    // the primed states and the starting key/voice come with the external files
    await externalFilesLoaded;
    resetBachDuetState();
    console.log(`BachDuet warmup on ${tf.getBackend()}: ` +
        inferenceTimes.map((t) => t.toFixed(1)).join(', ') + ' ms');

    // Once your model/agent is ready to play,
    // UI expects a success message, don't forget to send it.
    postMessage({
        hookType: self.agentHookType.INIT_AGENT,
        message: {
            [self.messageType.STATUS]:
                    self.statusType.SUCCESS,
            [self.messageType.TEXT]:
                    'The Agent is ready to interact with you!',
        },
    });
}
