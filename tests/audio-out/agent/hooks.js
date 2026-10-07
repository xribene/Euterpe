// @ts-check
import {defineAgent} from 'euterpe/agent';
let phase = 0;
let started = false;
const sine = (frames, sampleRate) => {
    const x = new Float32Array(frames);
    const step = 2 * Math.PI * 440 / sampleRate;
    for (let i = 0; i < frames; i++) {
        x[i] = 0.25 * Math.sin(phase);
        phase += step;
    }
    phase %= 2 * Math.PI;
    return x;
};
export default defineAgent({
    async renderAudio(frames, ctx) {
        if (ctx.urlParams.mode === 'push') return;
        // too slow on purpose: 40 ms per call
        if (ctx.urlParams.mode === 'slow') await new Promise((r) => setTimeout(r, 150));
        return sine(frames, ctx.audioOut.sampleRate);
    },
    // Button 1: updateParameter's return value is played like any hook's
    updateParameter({kind}, ctx) {
        if (kind === 'button') return [ctx.noteOn(72), ctx.noteOff(72, {seconds: 0.3})];
    },
    processClockEvent(clock, ctx) {
        if (ctx.urlParams.mode !== 'push') return;
        // one tick of audio per tick (two ahead at the start)
        const tickFrames = Math.round(ctx.audioOut.sampleRate * 60 / 100 / ctx.ticksPerBeat);
        const frames = started ? tickFrames : 2 * tickFrames;
        started = true;
        return {audio: sine(frames, ctx.audioOut.sampleRate)};
    },
});
