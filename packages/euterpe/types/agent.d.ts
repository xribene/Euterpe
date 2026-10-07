/**
 * euterpe/agent: what an agent's hooks import. The hooks run in a Web Worker (no DOM).
 */
import type {Config} from './config.js';

export type {Config, ConfigYaml, WidgetsYaml, PlayersYaml} from './config.js';

export declare const playerType: {readonly HUMAN: 0; readonly AGENT: 1; readonly METRONOME: 2};
export declare const instrumentType: {readonly PIANO: 0; readonly DRUMS: 1; readonly BASS: 2; readonly SYNTH: 3};
export declare const eventSourceType: {readonly MOUSE: 0; readonly MIDI_KEYBOARD: 1; readonly KEYBOARD: 2};
export declare const noteType: {readonly NOTE_ON: 1; readonly NOTE_OFF: -1; readonly NOTE_HOLD: 0; readonly REST: 2};
export declare const messageType: {
    readonly STATUS: 0; readonly CLOCK_TIME: 1; readonly INFERENCE_TIME: 2; readonly NOTE_LIST: 4;
    readonly AUDIO_BUFFER: 7; readonly CHROMA_VECTOR: 10; readonly VECTOR: 11; readonly CHORD_LABEL: 12;
    readonly TEXT: 13; readonly LABEL: 14; readonly KEY: 15; readonly SESSION: 16; readonly TIMING_RESET: 18;
};
export declare const statusType: {
    readonly LOADED: 0; readonly WARMUP: 1; readonly SUCCESS: 2; readonly ERROR: 3; readonly REPORT: 4;
};
export declare const uiParameterType: Readonly<Record<string, number>>;
export declare const agentHookType: {readonly CLOCK_EVENT: 0; readonly NOTE_EVENT: 1; readonly INIT_AGENT: 2};

/** A time as Euterpe keeps it: clock ticks and seconds. */
export interface TickTime {
    tick: number;
    seconds: number;
}

/** A note: the user's (from the hooks' input) or the agent's (from ctx.noteOn / ctx.noteOff / ctx.note). */
export declare class NoteEvent {
    constructor();
    /** playerType: HUMAN, AGENT or METRONOME. */
    player: number;
    /** instrumentType: PIANO, DRUMS, BASS or SYNTH. */
    instrument: number;
    /** eventSourceType of a user note: MOUSE (on-screen keyboard), MIDI_KEYBOARD or KEYBOARD (laptop). */
    eventSource: number;
    /** e.g. 'C#4' (user notes). */
    name: string;
    /** noteType: NOTE_ON 1, NOTE_OFF -1, NOTE_HOLD 0. */
    type: number;
    /** MIDI note number, 0-127. */
    midi: number;
    chroma: number | null;
    channel: number | null;
    velocity: number;
    /** When the note was played: `seconds` on the page's clock (compare with ctx.now()), and the tick. */
    createdAt: TickTime | null;
    /** When to play the note: `tick` ticks from now (0: at once) plus `seconds`. */
    playAfter: TickTime | null;
    /** If set, Euterpe sends the note-off itself after this long. */
    duration: TickTime | null;
    static fromPlain(plain: object): NoteEvent;
    static copy(note: NoteEvent): NoteEvent;
}

/** A note as a plain object, which Euterpe turns into a NoteEvent (ctx.note's arguments). */
export interface PlainNote extends NoteOptions {
    midi: number;
    type?: NoteTypeName | number;
}

export type NoteTypeName = 'on' | 'off' | 'hold';

export interface NoteOptions {
    /** Default 127. */
    velocity?: number;
    /** Default 'piano'. */
    instrument?: 'piano' | 'drums' | 'bass' | 'synth' | number;
    /** Play this many ticks from now; 0 (default): at once. */
    tick?: number;
    /** Plus this many seconds. */
    seconds?: number;
    /** If set, Euterpe sends the note-off itself after this long. */
    duration?: TickTime | null;
}

/** What a hook may return: notes, or named outputs for the UI, or nothing. */
export type HookOutput = void | null | undefined | Array<NoteEvent | PlainNote> | {
    /** Notes to play. */
    notes?: Array<NoteEvent | PlainNote>;
    /** Text for the text box (gui.textBox), or on the loading screen while loadAlgorithm runs. */
    text?: string;
    /** A short label for the text box. */
    label?: string;
    /** A vector for the chroma chart (gui.chromaChart). */
    vector?: number[];
    /** The key the agent hears, e.g. 'E♭ major' (used to spell notes in the score). */
    key?: string;
    /** Audio to play (interactionMode.audioOut): queued after what is already queued, like ctx.audioOut.write. */
    audio?: Float32Array | Float32Array[];
    /** The agent switched models: the UI restarts its max-BPM estimate. */
    timingReset?: boolean;
    /** A recorded session for the UI to download. */
    session?: unknown;
    /** The original protocol: values keyed by messageType number. */
    [messageType: number]: unknown;
};

/** The input of processClockEvent. */
export interface ClockEvent {
    /** The tick's position in the bar (0 to ticksPerMeasure - 1). */
    tick: number;
    /** Ticks since the clock started. */
    globalTick: number;
    /** The bar restarts at this tick (a button with resetsClock was pressed): reset the agent's state. */
    barReset: boolean;
    /** The user's notes on this tick, aligned to the grid; empty unless config.yaml gridBased.quantizedEvents is true. */
    userQuantizedNotes: NoteEvent[];
    /** Every user note since the last tick; empty unless config.yaml gridBased.eventBuffer is true. */
    userNotes: NoteEvent[];
}

/** A microphone frame: one Float32Array per channel (windowSize samples each), and where it sits in the stream. */
export type AudioFrame = Float32Array[] & {
    /** Samples (per channel, at sampleRate) since the microphone started, to the frame's first sample. */
    start: number;
    /** When the frame's first sample was captured, in seconds on the page's clock (ctx.now()); null until known. */
    time: number | null;
    sampleRate: number;
};

/** ctx.audioOut: the agent's audio output, a queue the page plays continuously. */
export interface AudioOut {
    /** The agent's output sample rate (audioOutSettings.sampleRate or the page's): write audio at this rate. */
    sampleRate: number;
    /** The page's (AudioContext's) sample rate. */
    pageSampleRate: number;
    /** renderAudio's fixed block size (audioOutSettings.blockSize), or null. */
    blockSize: number | null;
    /** When audio written now will be heard, in seconds on the page's clock (ctx.now()). */
    playTime(): number;
    /** audioOutSettings.channels (1 or 2). */
    channels: number;
    /** audioOutSettings.latency: seconds renderAudio keeps queued. */
    latency: number;
    /** Queues audio after what is already queued; returns the frames written (fewer if the queue is full). */
    write(data: Float32Array | Float32Array[]): number;
    /** Frames that can be written now. */
    space(): number;
    /** Frames queued and not played yet. */
    buffered(): number;
}

/** The input of updateParameter. */
export interface ParamChange {
    kind: 'slider' | 'switch' | 'button' | 'dropdown' | 'unknown';
    /** The widget's id in widgets.yaml (sliders and switches without one: their position, 1-based). */
    id: number;
    /** Slider: its value; switch: on/off; dropdown: the selected option's index; button: presses so far. */
    value: number | boolean;
    /** The raw uiParameterType index. */
    index: number;
}

/** The second argument of every hook. */
export interface Ctx {
    /** config.yaml, players.yaml and widgets.yaml, merged. */
    config: Config;
    /** The page's query parameters. */
    urlParams: Record<string, string>;
    ticksPerBeat: number;
    ticksPerMeasure: number;
    /** The widgets' current values, starting from widgets.yaml. */
    params: {
        /** By id in widgets.yaml. */
        slider: Record<number, number>;
        /** By id in widgets.yaml. */
        switch: Record<number, boolean>;
        /** By id: presses so far. */
        button: Record<number, number>;
        /** By id: the selected option's index. */
        dropdown: Record<number, number>;
    };
    /** Seconds on the page's clock, the clock of user notes' createdAt.seconds. */
    now(): number;
    /** The agent's audio output (config.yaml interactionMode.audioOut: true), or null. */
    audioOut: AudioOut | null;
    /**
     * The microphone's frames, once it runs (audio mode): their sample rate (audioModeSettings.sampleRate or the
     * page's), channels, window and hop sizes, and the page's own sample rate.
     */
    audio: {sampleRate: number; channelCount: number; windowSize: number; hopSize: number; pageSampleRate: number} | null;
    types: {
        noteType: typeof noteType;
        playerType: typeof playerType;
        instrumentType: typeof instrumentType;
        messageType: typeof messageType;
        statusType: typeof statusType;
        uiParameterType: typeof uiParameterType;
    };
    /** A note for the agent to play. */
    note(midi: number, type?: NoteTypeName | number, options?: NoteOptions): NoteEvent;
    noteOn(midi: number, options?: NoteOptions): NoteEvent;
    noteOff(midi: number, options?: NoteOptions): NoteEvent;
    /** Sends output outside a hook's return value (e.g. {text: 'Loading model...'} while loadAlgorithm runs). */
    send(output: HookOutput): void;
    /** Shows a value in the Monitor widget (widgets.yaml gui.monitor, parameter `id`). */
    monitor(id: number, value: number): void;
}

type Awaitable<T> = T | Promise<T>;

/** The agent's hooks: all optional, all may be async. */
export interface AgentHooks {
    /** Once at startup: load models and data. The start button appears when it resolves; if it throws, the error is shown. */
    loadAlgorithm?(ctx: Ctx): Awaitable<void>;
    /** Every clock tick (config.yaml gridBased.status: true). Budget: one tick. */
    processClockEvent?(clock: ClockEvent, ctx: Ctx): Awaitable<HookOutput>;
    /** Every user note, as it happens (config.yaml eventBased.status: true). */
    processNoteEvent?(note: NoteEvent, ctx: Ctx): Awaitable<HookOutput>;
    /** Every microphone frame (config.yaml interactionMode.audioMode: true): one Float32Array per channel. */
    processAudioBuffer?(frame: AudioFrame, ctx: Ctx): Awaitable<HookOutput>;
    /** A Settings widget changed; ctx.params already holds the new value. */
    updateParameter?(change: ParamChange, ctx: Ctx): Awaitable<HookOutput>;
    /**
     * Audio output (interactionMode.audioOut): return `frames` frames, one Float32Array per channel (or one for
     * all). Called whenever less than audioOut.latency seconds are queued, one call at a time.
     */
    renderAudio?(frames: number, ctx: Ctx): Awaitable<Float32Array | Float32Array[] | void>;
}

export declare const AGENT_MARK: unique symbol;
export declare const HOOK_NAMES: readonly string[];

export type Agent = AgentHooks & {readonly [AGENT_MARK]: true};

/** Declares the agent: `export default defineAgent({...})` in agent/hooks.js. */
export declare function defineAgent(hooks: AgentHooks): Agent;

/** A bounded stack: push beyond maxLength drops the oldest element. */
export declare class LIFOQueue<T = unknown> {
    constructor(maxLength: number);
    push(element: T): void;
    pop(): T | undefined;
    length(): number;
    clear(): void;
    toArray(): T[];
    toArrayAndClear(): T[];
}
/** A bounded queue. */
export declare class FIFOQueue<T = unknown> {
    constructor(maxLength: number);
    push(element: T): void;
    pop(): T | undefined;
    length(): number;
}
export declare function clamp(num: number, min: number, max: number): number;
/** Moves midi by octaves into [min, max]. */
export declare function clampMidi(midi: number, min: number, max: number): number;
export declare function deinterleaveCustom(input: Float32Array, output: Float32Array[], channelCount: number): void;

declare global {
    /**
     * Globals the worker runtime sets for agents written the original way (self.config, self.messageType, ...).
     * defineAgent hooks get the same through ctx.
     */
    interface WorkerGlobalScope {
        config: Config;
        urlParams: Record<string, string>;
        playerType: typeof playerType;
        instrumentType: typeof instrumentType;
        noteType: typeof noteType;
        statusType: typeof statusType;
        messageType: typeof messageType;
        uiParameterType: typeof uiParameterType;
        agentHookType: typeof agentHookType;
        ticksPerMeasure: number;
        sampleRate: number;
        channelCount: number;
    }
}
