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
            const planes = data instanceof Float32Array ? [data] : data;
            if (!Array.isArray(planes) || !planes.every((p) => p instanceof Float32Array)) {
                warn('ctx.audioOut.write: give a Float32Array or an array of Float32Arrays (one per channel)');
                return 0;
            }
            const frames = Math.min(Math.min(...planes.map((p) => p.length)), audioOut.space());
            if (frames < Math.max(...planes.map((p) => p.length))) {
                warn('ctx.audioOut: the output buffer is full; audio was dropped (write less ahead, or raise ' +
                    'audioOutSettings.latency)');
            }
            if (frames <= 0) return 0;
            if (staging.length < frames * channels) staging = new Float32Array(frames * channels);
            for (let c = 0; c < channels; c++) {
                const plane = planes[Math.min(c, planes.length - 1)];
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
    const target = Math.round(out.latency * out.sampleRate);
    let busy = false;
    const fill = async () => {
        if (busy || ctx._loading) return;
        busy = true;
        try {
            // render in blocks of 128 frames (the audio thread's quantum), at most 4096 at a time
            let frames = Math.min(target - out.buffered(), out.space(), 4096);
            frames -= frames % 128;
            if (frames > 0) {
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
