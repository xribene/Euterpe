// @ts-check
import {defineAgent} from 'euterpe/agent';
let phase = 0;
const stats = {frames: 0, sizes: new Set(), rates: new Set(), steps: new Set(), lastStart: -1, ages: [], rmsMax: 0, blocks: new Set()};
export default defineAgent({
    processAudioBuffer(frame, ctx) {
        stats.frames++;
        stats.sizes.add(frame[0].length);
        stats.rates.add(frame.sampleRate);
        if (stats.lastStart >= 0) stats.steps.add(frame.start - stats.lastStart);
        stats.lastStart = frame.start;
        // how long ago (s) the frame's last sample was captured
        if (frame.time !== null) stats.ages.push(ctx.now() - (frame.time + frame[0].length / frame.sampleRate));
        let s = 0;
        for (const x of frame[0]) s += x * x;
        stats.rmsMax = Math.max(stats.rmsMax, Math.sqrt(s / frame[0].length));
        if (stats.frames % 40 === 0) {
            const ages = stats.ages.slice(-40).sort((a, b) => a - b);
            return {label: JSON.stringify({frames: stats.frames, sizes: [...stats.sizes], rates: [...stats.rates],
                steps: [...stats.steps], ageMedianMs: Math.round(1000 * ages[Math.floor(ages.length / 2)]),
                rmsMax: +stats.rmsMax.toFixed(3), blocks: [...stats.blocks], audio: ctx.audio, out: {rate: ctx.audioOut?.sampleRate, page: ctx.audioOut?.pageSampleRate}})};
        }
    },
    renderAudio(frames, ctx) {
        stats.blocks.add(frames);
        const x = new Float32Array(frames);
        const step = 2 * Math.PI * 440 / ctx.audioOut.sampleRate;
        for (let i = 0; i < frames; i++) {
            x[i] = 0.25 * Math.sin(phase);
            phase += step;
        }
        phase %= 2 * Math.PI;
        return x;
    },
});
