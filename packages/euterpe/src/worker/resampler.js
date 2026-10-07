/**
 * A streaming sample-rate converter for one channel: windowed-sinc (Blackman) interpolation at any ratio, with
 * the low-pass a downsampling needs (cutoff at the lower of the two Nyquist frequencies). Feed it blocks of any
 * size; it keeps the history it needs between calls. Delay: `delay` seconds (24 samples of the slower rate).
 */
export class Resampler {
    /**
     * @param {number} inRate
     * @param {number} outRate
     * @param {{halfTaps?: number, phases?: number}} [options] - halfTaps: filter half-length in samples of the
     *     slower side (more: sharper low-pass, more CPU and delay); phases: the fractional positions tabulated.
     */
    constructor(inRate, outRate, {halfTaps = 24, phases = 512} = {}) {
        // downsampling: the filter spans the same time at the lower rate, i.e. ratio x more input samples
        halfTaps = Math.ceil(halfTaps / Math.min(1, outRate / inRate));
        this.inRate = inRate;
        this.outRate = outRate;
        this.step = inRate / outRate; // input samples per output sample
        this.halfTaps = halfTaps;
        this.phases = phases;
        // a little below the Nyquist frequency of the slower side, so the transition band doesn't alias
        const cutoff = 0.92 * Math.min(1, outRate / inRate);
        const width = 2 * halfTaps;
        // table[p * width + j]: the filter at fractional position p / phases for tap j (offset j - halfTaps + 1)
        this.table = new Float32Array((phases + 1) * width);
        for (let p = 0; p <= phases; p++) {
            for (let j = 0; j < width; j++) {
                const x = j - halfTaps + 1 - p / phases;
                const sinc = x === 0 ? 1 : Math.sin(Math.PI * cutoff * x) / (Math.PI * cutoff * x);
                const w = Math.abs(x) >= halfTaps ? 0 :
                    0.42 + 0.5 * Math.cos(Math.PI * x / halfTaps) + 0.08 * Math.cos(2 * Math.PI * x / halfTaps);
                this.table[p * width + j] = cutoff * sinc * w;
            }
        }
        this.buffer = new Float32Array(width); // history (zeros at the start)
        this.length = width;
        this.position = halfTaps - 1; // input position of the next output sample, in this.buffer
    }

    /**
     * @param {Float32Array} input
     * @return {Float32Array} The output samples this input makes available.
     */
    process(input) {
        const width = 2 * this.halfTaps;
        // history + input
        if (this.buffer.length < this.length + input.length) {
            const grown = new Float32Array(this.length + input.length + width);
            grown.set(this.buffer.subarray(0, this.length));
            this.buffer = grown;
        }
        this.buffer.set(input, this.length);
        this.length += input.length;
        const out = new Float32Array(Math.ceil((this.length - this.position) / this.step) + 1);
        let n = 0;
        let t = this.position;
        while (Math.floor(t) + this.halfTaps < this.length) {
            const i = Math.floor(t);
            const p = Math.round((t - i) * this.phases);
            const row = p * width;
            const first = i - this.halfTaps + 1;
            let sum = 0;
            for (let j = 0; j < width; j++) sum += this.buffer[first + j] * this.table[row + j];
            out[n++] = sum;
            t += this.step;
        }
        // keep what the next outputs need
        const keep = Math.floor(t) - this.halfTaps + 1;
        this.buffer.copyWithin(0, keep, this.length);
        this.length -= keep;
        this.position = t - keep;
        return out.subarray(0, n);
    }

    /**
     * The resampler's delay, in seconds: input sample 0 sits after 2 * halfTaps zeros of history and the first
     * output is centred at halfTaps - 1, so outputs lag inputs by halfTaps + 1 input samples.
     */
    get delay() {
        return (this.halfTaps + 1) / this.inRate;
    }
}
