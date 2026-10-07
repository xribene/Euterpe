/**
 * euterpe: the UI. A project's index.html calls mount(); the agent comes from agent/ through euterpe/vite.
 */
/** Mounts the Euterpe UI into `el` (default '#app') and returns the root Vue instance. */
export declare function mount(el?: string | Element): unknown;

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
    readonly params: {slider: Record<number, number>; switch: Record<number, boolean>; dropdown: Record<number, number>};
    setParam(kind: 'slider' | 'switch' | 'dropdown' | 'button', id: number, value?: number | boolean): void;
    /** A user note, as from the laptop keyboard. */
    noteOn(midi: number, velocity?: number): void;
    noteOff(midi: number): void;
    /** The agent's messages from number `since` on. */
    agentMessages(since?: number): Array<{t: number; hookType: number; message: Record<number, unknown>}>;
    readonly agentMessageCount: number;
    /** The agent's audio output: frames played and underruns so far (null if audioOut is off). */
    readonly audioOut: {played: number; underruns: number; playing: boolean} | null;
}

declare global {
    interface Window {
        __euterpe?: EuterpeHandle;
    }
}
