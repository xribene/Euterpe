// @ts-check
// Copycat: plays the user's notes back on the 16th-note grid, `Delay` ticks later and `Pitch Shift` semitones
// away (plus up to `Randomness` random semitones). Grid mode: Euterpe calls processClockEvent on every 16th.
import {defineAgent, clamp} from 'euterpe/agent';

// the note the agent is sounding, and the delay it was started with (its note-off must use the same one,
// or a Delay change could release it before it starts), or null
let sounding = null;

export default defineAgent({
    processClockEvent({userQuantizedNotes}, ctx) {
        const {NOTE_ON, NOTE_HOLD} = ctx.types.noteType;
        const [randomness, delay, pitchShift] = [ctx.params.slider[1], ctx.params.slider[2], ctx.params.slider[3]];
        const onset = userQuantizedNotes.find((note) => note.type === NOTE_ON);
        const held = userQuantizedNotes.some((note) => note.type === NOTE_HOLD);

        const notes = [];
        // the user released their note or played a new one: release ours
        if (sounding !== null && (onset || !held)) {
            notes.push(ctx.noteOff(sounding.midi, {tick: sounding.delay}));
            sounding = null;
        }
        if (onset) {
            const midi = clamp(onset.midi + pitchShift + Math.floor(Math.random() * randomness), 21, 108);
            sounding = {midi, delay};
            notes.push(ctx.noteOn(midi, {tick: delay, velocity: onset.velocity}));
        }
        return notes;
    },
});
