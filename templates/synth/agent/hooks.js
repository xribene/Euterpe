// @ts-check
// Synth: a polyphonic subtractive synthesizer. The user's notes come in as events (processNoteEvent), the sound
// is generated here, in the agent worker, and played through Euterpe's audio output (renderAudio, asked for
// whenever less than audioOutSettings.latency is queued). Per voice: an oscillator (sine, triangle, or a
// band-limited saw / square), a resonant low-pass filter and an ADSR envelope. Settings: the sliders and the
// Waveform dropdown (widgets.yaml).
import {defineAgent} from 'euterpe/agent';

const MAX_VOICES = 16;
const WAVES = ['sine', 'triangle', 'saw', 'square'];

/**
 * @typedef {{midi: number, freq: number, phase: number, gain: number, env: number,
 *     stage: 'attack' | 'decay' | 'sustain' | 'release', releaseStep: number, ic1: number, ic2: number}} Voice
 */
/** @type {Voice[]} */
let voices = [];

// PolyBLEP: smooths the saw's and square's jumps, so their harmonics don't alias above Nyquist
function polyBlep(t, dt) {
    if (t < dt) {
        t /= dt;
        return t + t - t * t - 1;
    }
    if (t > 1 - dt) {
        t = (t - 1) / dt;
        return t * t + t + t + 1;
    }
    return 0;
}

function oscillator(wave, t, dt) {
    switch (wave) {
    case 'sine': return Math.sin(2 * Math.PI * t);
    case 'triangle': return 1 - 4 * Math.abs(t - 0.5);
    case 'saw': return 2 * t - 1 - polyBlep(t, dt);
    default: return (t < 0.5 ? 1 : -1) + polyBlep(t, dt) - polyBlep((t + 0.5) % 1, dt); // square
    }
}

function noteOn(midi, velocity) {
    if (voices.length >= MAX_VOICES) {
        // steal the quietest releasing voice, else the oldest
        const releasing = voices.filter((v) => v.stage === 'release').sort((a, b) => a.env - b.env)[0];
        voices.splice(voices.indexOf(releasing ?? voices[0]), 1);
    }
    voices.push({midi, freq: 440 * 2 ** ((midi - 69) / 12), phase: 0, gain: velocity / 127, env: 0,
        stage: 'attack', releaseStep: 0, ic1: 0, ic2: 0});
}

function noteOff(midi, releaseSamples) {
    for (const v of voices) {
        if (v.midi === midi && v.stage !== 'release') {
            v.stage = 'release';
            v.releaseStep = v.env / releaseSamples;
        }
    }
}

export default defineAgent({
    processNoteEvent(note, ctx) {
        const {NOTE_ON, NOTE_OFF} = ctx.types.noteType;
        const sampleRate = ctx.audioOut?.sampleRate ?? 44100;
        if (note.type === NOTE_ON) noteOn(note.midi, note.velocity);
        else if (note.type === NOTE_OFF) noteOff(note.midi, Math.max(1, ctx.params.slider[6] / 1000 * sampleRate));
    },

    renderAudio(frames, ctx) {
        const out = new Float32Array(frames);
        const sampleRate = ctx.audioOut?.sampleRate ?? 44100;
        const p = ctx.params.slider;
        const wave = WAVES[ctx.params.dropdown[1]] ?? 'saw';
        const attackStep = 1 / Math.max(1, p[3] / 1000 * sampleRate);
        const sustain = p[5] / 100;
        const decayStep = (1 - sustain) / Math.max(1, p[4] / 1000 * sampleRate);
        // the low-pass filter (a zero-delay-feedback state-variable filter: stable at any cutoff), set per block
        const g = Math.tan(Math.PI * Math.min(p[1], 0.45 * sampleRate) / sampleRate);
        const k = 2 - 2 * (p[2] / 100); // damping: 2 (none) to 0.1 (strong resonance)
        const a1 = 1 / (1 + g * (g + k));
        const a2 = g * a1;
        const a3 = g * a2;
        for (const v of voices) {
            const dt = v.freq / sampleRate;
            for (let i = 0; i < frames; i++) {
                // envelope
                if (v.stage === 'attack') {
                    v.env += attackStep;
                    if (v.env >= 1) {
                        v.env = 1;
                        v.stage = 'decay';
                    }
                } else if (v.stage === 'decay') {
                    v.env -= decayStep;
                    if (v.env <= sustain) {
                        v.env = sustain;
                        v.stage = 'sustain';
                    }
                } else if (v.stage === 'release') {
                    v.env -= v.releaseStep;
                    if (v.env <= 0) {
                        v.env = 0;
                        break;
                    }
                }
                // oscillator -> filter
                const x = oscillator(wave, v.phase, dt);
                v.phase += dt;
                if (v.phase >= 1) v.phase -= 1;
                const v3 = x - v.ic2;
                const v1 = a1 * v.ic1 + a2 * v3;
                const v2 = v.ic2 + a2 * v.ic1 + a3 * v3;
                v.ic1 = 2 * v1 - v.ic1;
                v.ic2 = 2 * v2 - v.ic2;
                out[i] += v2 * v.env * v.gain;
            }
        }
        voices = voices.filter((v) => v.env > 0 || v.stage !== 'release');
        // headroom for chords, and a soft limit instead of hard clipping
        for (let i = 0; i < frames; i++) {
            const y = 0.3 * out[i];
            out[i] = y / (1 + Math.abs(y));
        }
        return out;
    },
});
