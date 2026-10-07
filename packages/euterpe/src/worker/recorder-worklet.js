/* eslint-disable require-jsdoc */
// eslint-disable-next-line no-unused-vars
const exports = {};

class RecorderWorklet extends AudioWorkletProcessor {
    static get parameterDescriptors() {
        return [{
            name: 'recordingStatus',
            defaultValue: 0,
            minValue: 0,
            maxValue: 1,
        },
        ];
    }
    constructor(options) {
        super();
        // Staging buffer to interleave the audio data.
        this.interleaved = new Float32Array(128 * 2); // stereo
        const sab = options.processorOptions;
        this._audio_writer = new AudioWriter(new RingBuffer(sab, Float32Array));
        this.port.onmessage = (e) => {
            console.debug('Received from Node' + e.data);
            this.port.postMessage('pong');
        };
    }


    process(inputs, _outputs, _parameters) {
        // TODO : if (_parameters.recordingStatus[0] ===1)

        const input = inputs[0];
        // nothing connected yet: no channels
        if (!input || input.length === 0) return true;
        if (!this.started) {
            // when the first sample was recorded (audio clock), for the frames' timestamps
            this.started = true;
            this.port.postMessage({start: currentTime});
        }
        // two channels, interleaved (the node is set to 2; a mono input is used for both), any block size
        const left = input[0];
        const right = input[1] ?? input[0];
        if (this.interleaved.length !== 2 * left.length) this.interleaved = new Float32Array(2 * left.length);
        for (let i = 0; i < left.length; i++) {
            this.interleaved[2 * i] = left[i];
            this.interleaved[2 * i + 1] = right[i];
        }
        const written = this._audio_writer.enqueue(this.interleaved);
        if (written < this.interleaved.length) {
            // the queue was full (the worker fell behind): report the samples lost, for the timestamps
            this.port.postMessage({dropped: (this.interleaved.length - written) / 2});
        }
        return true;
    }
}

registerProcessor('recorder-worklet', RecorderWorklet);
