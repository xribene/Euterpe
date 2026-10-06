// The agent's hooks, called by Euterpe's agent worker (every hook is optional)
export {updateParameter, loadAlgorithm, loadExternalFiles} from './initAgent_hook.js';
export {processClockEvent} from './processClockEvent_hook.js';
export {processNoteEvent} from './processNoteEvent_hook.js';
export {processAudioBuffer} from './processAudioBuffer_hook.js';
