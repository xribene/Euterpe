// @ts-check
// Call & Response: collects the user's phrase note by note (event mode) and, once they have been silent for
// SILENCE seconds, answers with the same phrase in their rhythm, `Pitch Shift` semitones away (plus up to
// `Randomness` random semitones). The clock (grid mode) is only used to check for the silence.
import {defineAgent, clamp} from 'euterpe/agent';

const SILENCE = 1.5; // seconds

// the user's notes since the last answer, and when the last one came (seconds, ctx.now())
let phrase = [];
let lastNoteAt = 0;
// the answer is still playing until then
let answerEndsAt = 0;
// the user's MIDI note -> the agent's, so a note-off releases the right note
const answerMidi = {};

export default defineAgent({
    processNoteEvent(noteEvent) {
        phrase.push(noteEvent);
        lastNoteAt = noteEvent.createdAt.seconds;
    },

    processClockEvent(clock, ctx) {
        const now = ctx.now();
        if (phrase.length === 0 || now - lastNoteAt < SILENCE || now < answerEndsAt) return;
        const {NOTE_ON} = ctx.types.noteType;
        const [randomness, pitchShift] = [ctx.params.slider[1], ctx.params.slider[2]];

        // play the phrase back in the user's rhythm: createdAt.seconds is when each note was played
        const start = phrase[0].createdAt.seconds;
        const notes = phrase.map((note) => {
            if (note.type === NOTE_ON) {
                answerMidi[note.midi] = clamp(note.midi + pitchShift + Math.floor(Math.random() * randomness), 21, 108);
            }
            const midi = answerMidi[note.midi] ?? note.midi + pitchShift;
            return ctx.note(midi, note.type, {seconds: note.createdAt.seconds - start, velocity: note.velocity});
        });
        answerEndsAt = now + phrase[phrase.length - 1].createdAt.seconds - start;
        phrase = [];
        return notes;
    },
});
