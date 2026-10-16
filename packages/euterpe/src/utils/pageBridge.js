/**
 * Page messages: the project's own page code (its index.html, its widgets) talking to the agent, outside
 * Euterpe's UI. mount() returns sendToAgent / onAgentMessage (src/index.js); the agent gets the data in its
 * processPageMessage hook and answers with {page: data}, which reaches the onAgentMessage listeners.
 */

// messages sent before the agent worker exists (mount() returns before the UI's chunk has loaded)
const pending = [];
const listeners = new Set();
let worker = null;

/**
 * Sends data to the agent's processPageMessage hook.
 * @param {*} data - Anything structured-cloneable (plain objects, arrays, numbers, strings, typed arrays).
 */
export function sendToAgent(data) {
    // a copy now, as postMessage would make: the data can't change while it waits
    if (worker) worker.postMessage({control: 'pageMessage', data});
    else pending.push(structuredClone(data));
}

/**
 * Calls `listener(data)` for every {page: data} the agent sends.
 * @param {function(*): void} listener
 * @return {function(): void} Removes the listener.
 */
export function onAgentMessage(listener) {
    if (typeof listener !== 'function') throw new TypeError('onAgentMessage: the listener must be a function');
    listeners.add(listener);
    return () => listeners.delete(listener);
}

/**
 * Connects the agent worker (Euterpe.vue, after the INIT_AGENT message) and sends what was waiting.
 * @param {Worker} agentWorker
 */
export function attachWorker(agentWorker) {
    worker = agentWorker;
    for (const data of pending.splice(0)) worker.postMessage({control: 'pageMessage', data});
}

/**
 * Passes a page message from the agent (messageType.PAGE) to the listeners.
 * @param {*} data
 */
export function deliverToPage(data) {
    for (const listener of listeners) {
        try {
            listener(data);
        } catch (error) {
            console.error('[euterpe] an onAgentMessage listener failed', error);
        }
    }
}
