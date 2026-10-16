/**
 * euterpe: the UI. A project's index.html calls mount(); the agent comes from agent/ through euterpe/vite.
 */
/** Mounts the Euterpe UI into `el` (default '#app'). */
export declare function mount(el?: string | Element): EuterpeApp;

/** What mount() returns: the project's page code talks to the agent through it. */
export interface EuterpeApp {
    /** The root Vue instance. */
    readonly vm: unknown;
    /**
     * Sends `data` to the agent's processPageMessage(data, ctx) hook, e.g. a press on the page's own widget.
     * `data` must be structured-cloneable (plain objects, arrays, numbers, strings, typed arrays). Messages sent
     * before the agent has loaded wait for it.
     */
    sendToAgent(data: unknown): void;
    /** Calls `listener` with every `{page: data}` the agent sends (a hook's return value or ctx.send). Returns an unsubscribe. */
    onAgentMessage(listener: (data: any) => void): () => void;
}

/** window.__euterpe: the running UI's handle for tests and scripts. */
export interface EuterpeHandle {
    readonly config: import('./config.js').Config;
    /** The agent loaded and the permissions are granted. */
    readonly ready: boolean;
    whenReady(timeoutMs?: number): Promise<true>;
    /** The start button was pressed (or enter() called). */
    readonly entered: boolean;
    /** What the start button does. */
    enter(): void;
    readonly clockRunning: boolean;
    startClock(): void;
    stopClock(): void;
    readonly tick: {local: number; global: number};
    readonly bpm: number;
    setBPM(bpm: number): void;
    /** As the agent's ctx.params. */
    readonly params: {slider: Record<number, number>; switch: Record<number, boolean>; dropdown: Record<number, number>;
        text: Record<number, string>};
    setParam(kind: 'slider' | 'switch' | 'dropdown' | 'button' | 'text', id: number, value?: number | boolean | string): void;
    /** A user note, as from the laptop keyboard. */
    noteOn(midi: number, velocity?: number): void;
    noteOff(midi: number): void;
    /** The agent's messages from number `since` on. */
    agentMessages(since?: number): Array<{t: number; hookType: number; message: Record<number, unknown>}>;
    readonly agentMessageCount: number;
    /** The agent's audio output: frames played and underruns so far (null if audioOut is off). */
    readonly audioOut: {played: number; underruns: number; playing: boolean; quantum: number; peak: number} | null;
}

declare global {
    interface Window {
        __euterpe?: EuterpeHandle;
    }
}
