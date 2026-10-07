// Unit tests of the microphone framer (audioIn.js) and of the audio output at another sample rate / with a
// fixed block size (audioOut.js).   node tests/audio-io/framer.test.mjs
import assert from 'node:assert/strict';
import {RingBuffer} from 'ringbuf.js';
import {createFramer} from '../../packages/euterpe/src/worker/audioIn.js';
import {createAudioOut, startRenderLoop, outputCapacity} from '../../packages/euterpe/src/worker/audioOut.js';

const ok = (name) => console.log(`ok  ${name}`);
// interleaved stereo: left = sample index, right = -index
const ramp = (from, n) => {
    const x = new Float32Array(2 * n);
    for (let i = 0; i < n; i++) {
        x[2 * i] = from + i;
        x[2 * i + 1] = -(from + i);
    }
    return x;
};

{
    const framer = createFramer({channels: 2, inRate: 48000, outRate: 48000, windowSize: 1024, hopSize: 256});
    const frames = [];
    let fed = 0;
    for (const n of [100, 900, 1, 3000, 37, 2000]) {
        frames.push(...framer.push(ramp(fed, n)));
        fed += n;
    }
    assert.equal(frames.length, Math.floor((fed - 1024) / 256) + 1);
    frames.forEach((f, k) => {
        assert.equal(f.start, k * 256);
        assert.equal(f.planes.length, 2);
        assert.equal(f.planes[0].length, 1024);
        // every sample is the right one, the last one included (the old framer left it stale)
        for (let i = 0; i < 1024; i++) {
            assert.equal(f.planes[0][i], k * 256 + i);
            assert.equal(f.planes[1][i], -(k * 256 + i));
        }
    });
    ok(`window 1024, hop 256: ${frames.length} frames, each exactly samples start..start+1023 of the stream`);
}
{
    const framer = createFramer({channels: 2, inRate: 48000, outRate: 16000, windowSize: 512, hopSize: 512});
    const x = new Float32Array(2 * 48000);
    for (let i = 0; i < 48000; i++) x[2 * i] = x[2 * i + 1] = 0.5 * Math.sin(2 * Math.PI * 440 * i / 48000);
    const frames = framer.push(x);
    assert.ok(Math.abs(frames.length - Math.floor(16000 / 512)) <= 1, `${frames.length} frames`);
    assert.equal(frames[1].start, 512);
    const s = frames[5].planes[0];
    const rms = Math.sqrt(s.reduce((a, v) => a + v * v, 0) / s.length);
    assert.ok(Math.abs(rms - 0.3536) < 0.01, `rms ${rms}`);
    assert.ok(framer.delay > 0 && framer.delay < 0.005);
    ok(`48 kHz -> 16 kHz frames: ${frames.length} frames of 512 per second of input, level kept (rms ${rms.toFixed(4)}), delay ${(framer.delay * 1000).toFixed(2)} ms`);
}
{
    const framer = createFramer({channels: 2, inRate: 48000, outRate: 48000, windowSize: 256, hopSize: 256});
    assert.equal(framer.push(ramp(0, 1000)).length, 3);
    ok('hop = window: no overlap');
}

const make = (opts) => createAudioOut(RingBuffer.getStorageForCapacity(48000 * 2, Float32Array),
    {channels: 2, latency: 0.1, pageSampleRate: 48000, ...opts}, () => {}, () => 0);
{
    const out = make({sampleRate: 16000});
    const written = out.write(new Float32Array(1600)); // 0.1 s at 16 kHz
    assert.equal(written, 1600);
    // queued: about 0.1 s at 48 kHz, minus the resampler's delay, reported in agent (16 kHz) frames
    assert.ok(Math.abs(out.buffered() - 1600) <= 4, `buffered ${out.buffered()}`); // (+ the filter start-up)
    assert.ok(Math.abs(out.playTime() - out.buffered() / 16000) < 0.002);
    ok(`agent at 16 kHz into a 48 kHz page: 1600 frames written, ${out.buffered()} queued (agent frames), playTime matches`);
}
{
    const out = make({sampleRate: 16000, blockSize: 2048, latency: 0.05});
    const sizes = new Set();
    const ctx = {audioOut: out, _loading: false};
    const interval = startRenderLoop((frames) => (sizes.add(frames), new Float32Array(frames)), ctx, (e) => {
        throw e;
    });
    await new Promise((r) => setTimeout(r, 100));
    clearInterval(interval);
    assert.deepEqual([...sizes], [2048]);
    assert.ok(out.buffered() >= 2 * 2048, `buffered ${out.buffered()}`);
    ok(`blockSize 2048: renderAudio always asked for exactly 2048 frames; ${out.buffered()} queued (at least two blocks)`);
}
{
    const framer = createFramer({channels: 2, inRate: 48000, outRate: 48000, windowSize: 256, hopSize: 256});
    const before = framer.push(ramp(0, 600)); // frames at 0, 256; 88 samples left over
    framer.gap(1000); // the recorder dropped 1000 samples
    const after = framer.push(ramp(1600, 600));
    assert.deepEqual(before.map((f) => f.start), [0, 256]);
    assert.equal(after[0].start, 600 + 1000); // the leftover 88 and the 1000 dropped are skipped
    assert.equal(after[0].planes[0][0], 1600);
    ok(`a gap of 1000 samples: the next frame starts at ${after[0].start}, with the first sample after the gap`);
}
{
    // small fixed blocks: one fill renders as many as the target needs (it used to be one per 5 ms)
    const out = createAudioOut(RingBuffer.getStorageForCapacity(outputCapacity({latency: 0.1, blockSize: 128}, 48000) * 2, Float32Array),
        {channels: 2, latency: 0.1, sampleRate: 48000, pageSampleRate: 48000, blockSize: 128}, () => {}, () => 0);
    let calls = 0;
    const interval = startRenderLoop((frames) => (calls++, new Float32Array(frames)), {audioOut: out, _loading: false}, (e) => {
        throw e;
    });
    await new Promise((r) => setTimeout(r, 20));
    clearInterval(interval);
    assert.ok(out.buffered() >= 4800, `buffered ${out.buffered()}`);
    ok(`blockSize 128 at 48 kHz: the 0.1 s target filled within 20 ms (${calls} calls, ${out.buffered()} frames)`);
}
{
    // a large fixed block fits the ring buffer (it used to be sized from the latency only)
    const opts = {latency: 0.1, blockSize: 16384, sampleRate: 16000};
    const out = createAudioOut(RingBuffer.getStorageForCapacity(outputCapacity(opts, 48000) * 2, Float32Array),
        {channels: 2, pageSampleRate: 48000, ...opts}, () => {}, () => 0);
    assert.ok(out.space() >= 2 * 16384, `space ${out.space()}`);
    const sizes = [];
    const interval = startRenderLoop((frames) => (sizes.push(frames), new Float32Array(frames)), {audioOut: out, _loading: false}, (e) => {
        throw e;
    });
    await new Promise((r) => setTimeout(r, 50));
    clearInterval(interval);
    assert.ok(sizes.length >= 2 && sizes.every((n) => n === 16384), `sizes ${sizes}`);
    ok(`blockSize 16384 at 16 kHz on a 48 kHz page: room for ${out.space() + out.buffered()} frames, renderAudio called with 16384`);
}
console.log('all passed');
