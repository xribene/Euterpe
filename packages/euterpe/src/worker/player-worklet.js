/* eslint-disable require-jsdoc */
// eslint-disable-next-line no-unused-vars
const exports = {}; // for ringbuf-classic.js, concatenated after this file
// The agent's audio output: plays the interleaved frames the agent worker writes into a SharedArrayBuffer ring
// buffer (ctx.audioOut / renderAudio). Loaded together with ringbuf-classic.js (RingBuffer, AudioReader).
//
// It starts once `prebuffer` frames are queued; if the queue runs dry (an underrun: the agent wrote too slowly)
// it plays silence and waits for `prebuffer` frames again, rather than crackling sample by sample. Every 0.5 s
// it reports frames played, underruns and the peak level to the page. It plays nothing before the page sends {play: true}
// (the user pressed the start button).

class EuterpePlayer extends AudioWorkletProcessor {
    constructor(options) {
        super();
        const {sab, channels, prebuffer} = options.processorOptions;
        this.reader = new AudioReader(new RingBuffer(sab, Float32Array));
        this.channels = channels;
        this.prebuffer = prebuffer * channels; // in samples
        this.staging = new Float32Array(128 * channels);
        this.playing = false;
        this.played = 0;
        this.underruns = 0;
        this.peak = 0; // the loudest sample since the last report
        this.reportedAt = 0;
        // silent until the page says the user has started (the start button)
        this.enabled = false;
        this.port.onmessage = ({data}) => {
            if (data?.play) this.enabled = true;
        };
    }

    process(inputs, outputs) {
        const out = outputs[0];
        const frames = out[0].length;
        const samples = frames * this.channels;
        if (this.staging.length !== samples) this.staging = new Float32Array(samples);
        const available = this.reader.available_read();
        if (this.enabled && !this.playing && available >= Math.max(this.prebuffer, samples)) this.playing = true;
        if (this.playing) {
            if (available < samples) {
                // underrun: silence (outputs start zeroed) until the prebuffer is full again
                this.playing = false;
                this.underruns++;
            } else {
                this.reader.dequeue(this.staging);
                for (let c = 0; c < out.length; c++) {
                    const source = Math.min(c, this.channels - 1); // mono goes to every output channel
                    const channel = out[c];
                    for (let i = 0; i < frames; i++) {
                        const x = this.staging[i * this.channels + source];
                        channel[i] = x;
                        if (x > this.peak) this.peak = x;
                        else if (-x > this.peak) this.peak = -x;
                    }
                }
                this.played += frames;
            }
        }
        if (currentTime - this.reportedAt >= 0.5) {
            this.reportedAt = currentTime;
            // quantum: the frames per process() call, so the producer keeps at least two queued
            this.port.postMessage({played: this.played, underruns: this.underruns, playing: this.playing, quantum: frames,
                peak: this.peak});
            this.peak = 0;
        }
        return true;
    }
}

registerProcessor('euterpe-player', EuterpePlayer);
