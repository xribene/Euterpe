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

// marks an agent made with defineAgent (its hooks get the ctx argument and the runtime reports readiness)
export const AGENT_MARK = Symbol.for('euterpe.agent');

export const HOOK_NAMES = ['loadAlgorithm', 'processClockEvent', 'processNoteEvent', 'processAudioBuffer',
    'updateParameter'];

/**
 * Declares the agent. agent/hooks.js does `export default defineAgent({...})`; every hook is optional and may be
 * async. Each hook gets its input and `ctx` (config, widget values, note helpers, send):
 *
 *   loadAlgorithm(ctx)                  once at startup: load models; the UI waits until it resolves
 *   processClockEvent(clock, ctx)       every tick (grid mode): clock.tick, clock.userQuantizedNotes, ...
 *   processNoteEvent(noteEvent, ctx)    every user note (event mode)
 *   processAudioBuffer(channels, ctx)   every microphone frame (audio mode)
 *   updateParameter(change, ctx)        a widget changed: change.kind ('slider' | 'switch' | 'button' |
 *                                       'dropdown'), change.id, change.value (ctx.params is already updated)
 *
 * A hook returns the agent's output: an array of notes, or {notes, text, label, vector, key}, or nothing.
 * @param {Object} hooks
 * @return {Object} The agent, as the worker runtime calls it.
 */
export function defineAgent(hooks) {
    for (const [name, hook] of Object.entries(hooks)) {
        if (!HOOK_NAMES.includes(name)) {
            console.warn(`defineAgent: unknown hook "${name}" (hooks: ${HOOK_NAMES.join(', ')})`);
        } else if (typeof hook !== 'function') {
            throw new TypeError(`defineAgent: ${name} must be a function, got ${typeof hook}`);
        }
    }
    return {...hooks, [AGENT_MARK]: true};
}
