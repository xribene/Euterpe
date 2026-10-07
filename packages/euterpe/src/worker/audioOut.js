/**
 * The agent's audio output, worker side: ctx.audioOut writes interleaved frames into the ring buffer the
 * page's player worklet (player-worklet.js) reads, and startRenderLoop() keeps it filled from renderAudio().
 */
import {AudioWriter, RingBuffer} from 'ringbuf.js';

/**
 * @param {SharedArrayBuffer} sab - The ring buffer's storage (from the page).
 * @param {{channels: number, latency: number, sampleRate: number}} options
 * @param {(text: string) => void} warn
 * @return {Object} ctx.audioOut
 */
export function createAudioOut(sab, {channels, latency, sampleRate}, warn) {
    const ringbuf = new RingBuffer(sab, Float32Array);
    const writer = new AudioWriter(ringbuf);
    let staging = new Float32Array(0);
    const audioOut = {
        sampleRate,
        channels,
        /** Seconds of audio renderAudio keeps queued ahead of playback (audioOutSettings.latency). */
        latency,
        /** Frames that can be written now. */
        space: () => Math.floor(writer.available_write() / channels),
        /** Frames queued and not played yet. */
        buffered: () => Math.floor((ringbuf.capacity() - writer.available_write()) / channels),
        /**
         * Queues audio for playback, after what is already queued.
         * @param {Float32Array|Float32Array[]} data - One Float32Array per channel (a single Float32Array is
         *     the same signal on every channel).
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
            if (staging.length < frames * channels) staging = new Float32Array(frames * channels);
            for (let c = 0; c < channels; c++) {
                const plane = used[Math.min(c, used.length - 1)];
                for (let i = 0; i < frames; i++) staging[i * channels + c] = plane[i];
            }
            writer.enqueue(staging.subarray(0, frames * channels));
            return frames;
        },
    };
    return audioOut;
}

/**
 * Calls renderAudio(frames, ctx) whenever the queue holds less than audioOut.latency seconds, so the agent's
 * audio plays continuously; one call at a time (it may be async).
 * @param {Function} renderAudio
 * @param {Object} ctx
 * @param {(error: Error) => void} onError
 * @return {number} The interval id.
 */
export function startRenderLoop(renderAudio, ctx, onError) {
    const out = ctx.audioOut;
    // whole 128-frame blocks (the audio thread's quantum), at least two, so playback can always start (the
    // player starts with latency / 2 or one quantum queued, whichever is more)
    const BLOCK = 128;
    const latencyTarget = Math.max(2 * BLOCK, Math.ceil(out.latency * out.sampleRate / BLOCK) * BLOCK);
    let busy = false;
    const fill = async () => {
        if (busy || ctx._loading || out.unavailable) return;
        busy = true;
        try {
            // up to the target (and two of the player's quanta: out.quantum, reported by the page), rounded up to
            // whole blocks; at most 4096 frames at a time
            const target = Math.max(latencyTarget, 2 * (out.quantum ?? BLOCK));
            const missing = target - out.buffered();
            const room = out.space() - out.space() % BLOCK;
            const frames = Math.min(Math.ceil(missing / BLOCK) * BLOCK, room, 4096);
            if (missing > 0 && frames > 0) {
                const audio = await renderAudio(frames, ctx);
                if (audio) out.write(audio);
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
