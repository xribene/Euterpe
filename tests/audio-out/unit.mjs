// Unit tests of the agent audio output's worker side (packages/euterpe/src/worker/audioOut.js), in Node.
//   node tests/audio-out/unit.mjs
import assert from 'node:assert/strict';
import {RingBuffer} from 'ringbuf.js';
import {createAudioOut, startRenderLoop} from '../../packages/euterpe/src/worker/audioOut.js';

const warnings = [];
const warn = (text) => warnings.push(text);
const make = (channels, seconds = 1, sampleRate = 48000, latency = 0.1) =>
    createAudioOut(RingBuffer.getStorageForCapacity(Math.ceil(sampleRate * seconds) * channels, Float32Array),
        {channels, latency, sampleRate}, warn);
const test = async (name, fn) => {
    warnings.length = 0;
    await fn();
    console.log(`ok  ${name}`);
};

await test('an empty planes array writes nothing (no throw)', () => {
    const out = make(2);
    assert.equal(out.write([]), 0);
    assert.equal(out.buffered(), 0);
});
await test('mono: an extra (empty) plane does not truncate the one played', () => {
    const out = make(1);
    assert.equal(out.write([new Float32Array(256).fill(0.5), new Float32Array(0)]), 256);
    assert.equal(out.buffered(), 256);
    assert.equal(warnings.length, 0);
});
await test('stereo: one plane goes to both channels', () => {
    const out = make(2);
    assert.equal(out.write(new Float32Array(100)), 100);
    assert.equal(out.buffered(), 100);
});
await test('stereo: planes of different lengths: the shortest sets the length, with a warning', () => {
    const out = make(2);
    assert.equal(out.write([new Float32Array(300), new Float32Array(200)]), 200);
    assert.match(warnings[0], /different lengths/);
});
await test('a full queue drops the rest, with a warning, and only whole frames', () => {
    const out = make(2, 0.01, 48000); // 480 frames
    assert.equal(out.write([new Float32Array(1000), new Float32Array(1000)]), 480);
    assert.match(warnings[0], /buffer is full/);
    assert.equal(out.space(), 0);
});
await test('not a Float32Array: a warning, nothing written', () => {
    const out = make(1);
    assert.equal(out.write([[0, 1, 2]]), 0);
    assert.match(warnings[0], /Float32Array/);
});
await test('render loop: a tiny latency still queues at least two of the player\'s quanta', async () => {
    const out = make(1, 1, 48000, 0.01); // 480 frames of latency
    out.quantum = 512; // as reported by a player whose process() gets 512 frames
    const ctx = {audioOut: out, _loading: false};
    const interval = startRenderLoop((frames) => new Float32Array(frames), ctx, (e) => {
        throw e;
    });
    await new Promise((r) => setTimeout(r, 100));
    clearInterval(interval);
    assert.ok(out.buffered() >= 1024, `buffered ${out.buffered()}`);
    assert.equal(out.buffered() % 128, 0);
});
await test('render loop: waits while the agent loads, and for an unavailable output', async () => {
    const out = make(1);
    const ctx = {audioOut: out, _loading: true};
    let calls = 0;
    const interval = startRenderLoop((frames) => (calls++, new Float32Array(frames)), ctx, () => {});
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(calls, 0);
    ctx._loading = false;
    await new Promise((r) => setTimeout(r, 50));
    assert.ok(calls > 0);
    out.unavailable = true;
    const before = calls;
    await new Promise((r) => setTimeout(r, 50));
    clearInterval(interval);
    assert.equal(calls, before);
    assert.equal(out.write(new Float32Array(10)), 0);
});
console.log('all passed');
