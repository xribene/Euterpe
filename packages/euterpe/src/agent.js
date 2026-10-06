/**
 * euterpe/agent: what an agent's hooks import. Runs inside the agent's Web Worker, so nothing here touches the
 * DOM or the UI.
 */
export {NoteEvent} from './utils/NoteEvent.js';
export {LIFOQueue, FIFOQueue} from './utils/dataStructures.js';
export {clamp, clampMidi} from './utils/math.js';
export {deinterleaveCustom} from './utils/helpers.js';
export {
    playerType, instrumentType, eventSourceType, messageType, statusType, noteType, uiParameterType, agentHookType,
} from './utils/types.js';

/**
 * Declares the agent's hooks. agent/hooks.js does `export default defineAgent({...})`; every hook is optional.
 * @param {Object} hooks - loadExternalFiles, loadAlgorithm, updateParameter, processClockEvent,
 *     processNoteEvent, processAudioBuffer.
 * @return {Object} The hooks, as the worker runtime calls them.
 */
export function defineAgent(hooks) {
    return hooks;
}
