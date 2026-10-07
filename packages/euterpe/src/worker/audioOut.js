/**
 * The agent's audio output, worker side: ctx.audioOut writes interleaved frames into the ring buffer the
 * page's player worklet (player-worklet.js) reads, and startRenderLoop() keeps it filled from renderAudio().
 * The agent works at its own sample rate (audioOutSettings.sampleRate, default the page's); if it differs from
 * the page's, its audio is resampled on the way in. Counts (frames) are at the agent's rate.
 */
import {AudioWriter, RingBuffer} from 'ringbuf.js';
import {Resampler} from './resampler.js';

/**
 * The output ring buffer's size in page frames: max(1 s, 4 x latency, 3 fixed blocks) of audio, plus room for
 * the resampler's history. (The page allocates it; here so the tests share it.)
 * @param {{latency: number, blockSize?: number|null, sampleRate?: number|null}} settings - The agent's.
 * @param {number} pageSampleRate
 * @return {number}
 */
export function outputCapacity({latency, blockSize = null, sampleRate = null}, pageSampleRate) {
    const agentRate = sampleRate ?? pageSampleRate;
    const seconds = Math.max(1, 4 * latency, 3 * (blockSize ?? 0) / agentRate);
    return Math.ceil(pageSampleRate * seconds) + 1024;
}

/**
 * @param {SharedArrayBuffer} sab - The ring buffer's storage (from the page).
 * @param {{channels: number, latency: number, sampleRate: number, pageSampleRate: number,
 *     blockSize?: number|null, outputLatency?: number}} options - sampleRate: the agent's; pageSampleRate: the
 *     AudioContext's (the ring buffer's).
 * @param {(text: string) => void} warn
 * @param {() => number} now - The page clock (ctx.now), for playTime().
 * @return {Object} ctx.audioOut
 */
export function createAudioOut(sab, {channels, latency, sampleRate, pageSampleRate, blockSize = null,
    outputLatency = 0}, warn, now) {
    const ringbuf = new RingBuffer(sab, Float32Array);
    const writer = new AudioWriter(ringbuf);
    const ratio = pageSampleRate / sampleRate; // page frames per agent frame
    // one resampler per output channel (if the rates differ); their delay is kept as a margin in space()
    const resamplers = ratio === 1 ? null :
        Array.from({length: channels}, () => new Resampler(sampleRate, pageSampleRate));
    const margin = resamplers ? 2 * resamplers[0].halfTaps + 2 : 0;
    let staging = new Float32Array(0);
    const pageFramesFree = () => Math.floor(writer.available_write() / channels);
    const pageFramesQueued = () => Math.floor((ringbuf.capacity() - writer.available_write()) / channels);

    const audioOut = {
        /** The agent's sample rate: write audio at this rate. */
        sampleRate,
        /** The page's (AudioContext's) sample rate. */
        pageSampleRate,
        channels,
        /** Seconds of audio renderAudio keeps queued ahead of playback (audioOutSettings.latency). */
        latency,
        /** renderAudio's fixed block size in frames (audioOutSettings.blockSize), or null. */
        blockSize,
        /** Frames that can be written now. */
        space: () => Math.max(0, Math.floor(pageFramesFree() / ratio) - margin),
        /** Frames queued and not played yet. */
        buffered: () => Math.floor(pageFramesQueued() / ratio),
        /**
         * When audio written now will be heard, in seconds on the page's clock (ctx.now()): after what is
         * queued, the resampler's delay (if any) and the device's output latency.
         * @return {number}
         */
        playTime: () => now() + pageFramesQueued() / pageSampleRate + (resamplers ? resamplers[0].delay : 0) +
            outputLatency,
        /**
         * Queues audio for playback, after what is already queued.
         * @param {Float32Array|Float32Array[]} data - One Float32Array per channel (a single Float32Array is
         *     the same signal on every channel), at audioOut.sampleRate.
         * @return {number} Frames written (fewer than given if the buffer is full).
         */
        write(data) {
            if (audioOut.unavailable) return 0;
            const planes = data instanceof Float32Array ? [data] : data;
            if (!Array.isArray(planes) || !planes.every((p) => p instanceof Float32Array)) {
                warn('ctx.audioOut.write: give a Float32Array or an array of Float32Arrays (one per channel)');
                return 0;
            }
            if (planes.length === 0) return 0;
            // the planes that are played: one per output channel (the last one repeats if there are fewer)
            const used = planes.slice(0, channels);
            const given = Math.min(...used.map((p) => p.length));
            if (used.some((p) => p.length !== given)) {
                warn('ctx.audioOut.write: the channels have different lengths; the shortest one sets the length');
            }
            const frames = Math.min(given, audioOut.space());
            if (frames < given) {
                warn('ctx.audioOut: the output buffer is full; audio was dropped (write less ahead, or raise ' +
                    'audioOutSettings.latency)');
            }
            if (frames <= 0) return 0;
            // per output channel, at the page's rate
            let out = Array.from({length: channels},
                (_, c) => used[Math.min(c, used.length - 1)].subarray(0, frames));
            if (resamplers) out = out.map((plane, c) => resamplers[c].process(plane));
            const pageFrames = Math.min(out[0].length, pageFramesFree());
            if (staging.length < pageFrames * channels) staging = new Float32Array(pageFrames * channels);
            for (let c = 0; c < channels; c++) {
                const plane = out[c];
                for (let i = 0; i < pageFrames; i++) staging[i * channels + c] = plane[i];
            }
            writer.enqueue(staging.subarray(0, pageFrames * channels));
            return frames;
        },
    };
    return audioOut;
}

/**
 * Calls renderAudio(frames, ctx) whenever the queue holds less than audioOut.latency seconds, so the agent's
 * audio plays continuously; one call at a time (it may be async). With audioOut.blockSize, `frames` is always
 * blockSize.
 * @param {Function} renderAudio
 * @param {Object} ctx
 * @param {(error: Error) => void} onError
 * @return {number} The interval id.
 */
export function startRenderLoop(renderAudio, ctx, onError) {
    const out = ctx.audioOut;
    // blocks of 128 frames (the audio thread's quantum) unless the agent fixed its own block size
    const BLOCK = out.blockSize ?? 128;
    let busy = false;
    const fill = async () => {
        if (busy || ctx._loading || out.unavailable) return;
        busy = true;
        try {
            // up to the latency, at least two blocks and two of the player's quanta (out.quantum, page frames,
            // reported by the page), in whole blocks; at most 4096 frames (or one fixed block) at a time
            const quantum = Math.ceil((out.quantum ?? 128) * out.sampleRate / out.pageSampleRate);
            const target = Math.max(2 * BLOCK, 2 * quantum, Math.ceil(out.latency * out.sampleRate / BLOCK) * BLOCK);
            // render until the target is reached (several calls if needed, e.g. small fixed blocks), but give
            // the worker back after ~4 ms so notes and widgets aren't held up
            const started = performance.now();
            for (;;) {
                const missing = target - out.buffered();
                const room = out.space() - out.space() % BLOCK;
                const frames = out.blockSize ? (room >= BLOCK ? BLOCK : 0) :
                    Math.min(Math.ceil(missing / BLOCK) * BLOCK, room, 4096);
                if (missing <= 0 || frames <= 0) break;
                const audio = await renderAudio(frames, ctx);
                if (!audio || out.write(audio) === 0) break;
                if (performance.now() - started > 4) break;
            }
        } catch (error) {
            onError(error);
        } finally {
            busy = false;
        }
    };
    return setInterval(fill, 5);
}

/**
 * The page could not start the player (e.g. a CSP that blocks the worklet): stop rendering, make writes no-ops.
 * @param {Object|null} audioOut
 * @param {number|null} interval - The render loop's interval, if any.
 */
export function disableAudioOut(audioOut, interval) {
    if (!audioOut || audioOut.unavailable) return;
    audioOut.unavailable = true;
    if (interval !== null) clearInterval(interval);
    console.warn('[euterpe] the page could not start the audio output: the agent\'s audio is not played');
}
