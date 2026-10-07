// Unit tests of the streaming resampler (packages/euterpe/src/worker/resampler.js).   node tests/audio-io/resampler.test.mjs
import assert from 'node:assert/strict';
import {Resampler} from '../../packages/euterpe/src/worker/resampler.js';

const sine = (hz, rate, seconds, amp = 0.5) => Float32Array.from({length: Math.round(rate * seconds)}, (_, i) => amp * Math.sin(2 * Math.PI * hz * i / rate));
const rms = (x) => Math.sqrt(x.reduce((a, v) => a + v * v, 0) / x.length);
// the frequency of a sine, from its zero crossings
const freq = (x, rate) => {
    let c = 0;
    for (let i = 1; i < x.length; i++) if (x[i - 1] < 0 && x[i] >= 0) c++;
    return c * rate / x.length;
};
const steady = (x, rate) => x.subarray(Math.round(0.05 * rate), x.length - Math.round(0.05 * rate));
const ok = (name) => console.log(`ok  ${name}`);

for (const [a, b] of [[48000, 16000], [44100, 22050], [16000, 48000], [48000, 44100], [44100, 48000]]) {
    const r = new Resampler(a, b);
    const y = r.process(sine(440, a, 1));
    assert.ok(Math.abs(y.length - b) <= r.halfTaps + 2, `length ${y.length} for ${b}`);
    const s = steady(y, b);
    assert.ok(Math.abs(freq(s, b) - 440) < 2, `freq ${freq(s, b)}`);
    assert.ok(Math.abs(rms(s) - 0.5 / Math.SQRT2) < 0.01, `rms ${rms(s)}`);
    ok(`${a} -> ${b}: 440 Hz kept (freq ${freq(s, b).toFixed(1)}, rms ${rms(s).toFixed(4)}), ${y.length} samples`);
}
{
    const y = steady(new Resampler(48000, 16000).process(sine(10000, 48000, 1)), 16000);
    const db = 20 * Math.log10(rms(y) / (0.5 / Math.SQRT2));
    assert.ok(db < -40, `10 kHz at ${db.toFixed(1)} dB`);
    ok(`48000 -> 16000: a 10 kHz tone (above the new Nyquist) is suppressed to ${db.toFixed(1)} dB`);
}
{
    const x = sine(440, 48000, 0.5);
    const whole = new Resampler(48000, 16000).process(x);
    const r = new Resampler(48000, 16000);
    const parts = [];
    for (let i = 0; i < x.length;) {
        const n = 1 + Math.floor(Math.random() * 700);
        parts.push(...r.process(x.subarray(i, i + n)));
        i += n;
    }
    assert.equal(parts.length, whole.length);
    assert.ok(parts.every((v, i) => Math.abs(v - whole[i]) < 1e-6));
    ok(`blocks of random size give the same output as one block (${parts.length} samples)`);
}
{
    const r = new Resampler(48000, 16000);
    const t0 = performance.now();
    for (let i = 0; i < 100; i++) r.process(sine(440, 48000, 0.1));
    const ms = performance.now() - t0;
    ok(`speed: 10 s of 48 kHz audio resampled in ${ms.toFixed(0)} ms (${(10000 / ms).toFixed(0)}x real time)`);
}
console.log('all passed');
