/**
 * The microphone's audio, worker side: interleaved samples from the recorder worklet's ring buffer become
 * per-channel frames of `windowSize` samples every `hopSize` samples (at the agent's sample rate, resampled from
 * the page's if they differ), each with its position in the stream.
 */
import {Resampler} from './resampler.js';

/**
 * @param {{channels: number, inRate: number, outRate: number, windowSize: number, hopSize: number}} options
 * @return {{push: (interleaved: Float32Array) => Array<{planes: Float32Array[], start: number}>, delay: number}}
 */
export function createFramer({channels, inRate, outRate, windowSize, hopSize}) {
    const makeResamplers = () => (inRate === outRate ? null :
        Array.from({length: channels}, () => new Resampler(inRate, outRate)));
    let resamplers = makeResamplers();
    // per channel: the samples not yet consumed by a frame (fifo[c].subarray(0, filled))
    const fifo = Array.from({length: channels}, () => new Float32Array(Math.max(windowSize * 2, 4096)));
    let filled = 0;
    let consumed = 0; // samples (per channel) dropped from the front of the fifo so far = the next frame's start

    const append = (planes) => {
        const n = planes[0].length;
        if (filled + n > fifo[0].length) {
            for (let c = 0; c < channels; c++) {
                const grown = new Float32Array((filled + n) * 2);
                grown.set(fifo[c].subarray(0, filled));
                fifo[c] = grown;
            }
        }
        for (let c = 0; c < channels; c++) fifo[c].set(planes[c], filled);
        filled += n;
    };

    return {
        /** The resampler's delay in seconds (0 without resampling). */
        delay: resamplers ? resamplers[0].delay : 0,
        /**
         * The recorder dropped `frames` input samples (per channel; its queue was full): the timeline skips them,
         * and the partial window and the resampler's history (from before the gap) are discarded.
         * @param {number} frames
         */
        gap(frames) {
            consumed += filled + Math.round(frames * outRate / inRate);
            filled = 0;
            resamplers = makeResamplers();
        },
        push(interleaved) {
            const n = Math.floor(interleaved.length / channels);
            let planes = Array.from({length: channels}, () => new Float32Array(n));
            for (let i = 0; i < n; i++) {
                for (let c = 0; c < channels; c++) planes[c][i] = interleaved[i * channels + c];
            }
            if (resamplers) planes = planes.map((p, c) => resamplers[c].process(p));
            append(planes);
            const frames = [];
            while (filled >= windowSize) {
                frames.push({planes: fifo.map((f) => f.slice(0, windowSize)), start: consumed});
                // advance by the hop
                for (let c = 0; c < channels; c++) fifo[c].copyWithin(0, hopSize, filled);
                filled -= hopSize;
                consumed += hopSize;
            }
            return frames;
        },
    };
}
