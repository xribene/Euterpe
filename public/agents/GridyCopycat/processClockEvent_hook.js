import {NoteEvent} from './../../../src/utils/NoteEvent.js';

let lastNote = null;
let prevStartTime = performance.now();

/**
 *
 * @param {Object} content
 * @return {Object}
 */
export function processClockEvent(content) {
    const startTime = performance.now();
    const timeDiff = startTime - prevStartTime;
    prevStartTime = startTime;

    const quantizedEvents = content.humanQuantizedInput;
    const noteList = [];
    const message = {};

    // filter the notes with note.type === self.noteType.NOTE_ON
    const noteOnEvents = quantizedEvents.filter((note) => note.type === self.noteType.NOTE_ON);
    const noteHoldEvents = quantizedEvents.filter((note) => note.type === self.noteType.NOTE_HOLD);
    if (noteOnEvents.length > 0) {
        if (lastNote) {
            // create a note off event
            const noteOffResponse = new NoteEvent();
            noteOffResponse.player = self.playerType.AGENT;
            noteOffResponse.instrument = self.instrumentType.PIANO;
            noteOffResponse.type = self.noteType.NOTE_OFF;
            noteOffResponse.midi = lastNote.midi;
            noteOffResponse.velocity = lastNote.velocity;
            noteOffResponse.playAfter = {
                tick: self.delay,
                seconds: 0,
            };
            noteList.push(noteOffResponse);
            lastNote = null;
        }

        const currentNote = noteOnEvents[0];
        const noteOnResponse = new NoteEvent();
        noteOnResponse.player = self.playerType.AGENT;
        noteOnResponse.instrument = self.instrumentType.PIANO;
        noteOnResponse.type = currentNote.type;
        noteOnResponse.midi = currentNote.midi + self.pitchShift + Math.floor(Math.random() * self.randomness);
        noteOnResponse.velocity = currentNote.velocity;
        noteOnResponse.playAfter = {
            tick: self.delay,
            seconds: 0,
        },
        noteList.push(noteOnResponse);
        lastNote = noteOnResponse;
        self.userToAgentNoteMapping[currentNote.midi] = noteOnResponse.midi;
        console.log('agent generated note: ' + noteOnResponse.midi);
    } else if (noteOnEvents.length === 0 && noteHoldEvents.length > 0) {
        if (lastNote) {
            // console.log(noteHoldEvents[0].midi, " ", lastNote.midi);
            // if (lastNote.midi + 12 !== noteHoldEvents[0].midi) {
            if (lastNote.midi !== self.userToAgentNoteMapping[noteHoldEvents[0].midi]) {
                // create a note off event
                const noteOffResponse = new NoteEvent();
                noteOffResponse.player = self.playerType.AGENT;
                noteOffResponse.instrument = self.instrumentType.PIANO;
                noteOffResponse.type = self.noteType.NOTE_OFF;
                noteOffResponse.midi = lastNote.midi;
                noteOffResponse.velocity = lastNote.velocity;
                noteOffResponse.playAfter = {
                    tick: self.delay,
                    seconds: 0,
                };
                noteList.push(noteOffResponse);
                lastNote = null;
            }
        }
    } else if (noteOnEvents.length === 0 && noteHoldEvents.length === 0) {
        if (lastNote) {
            // create a note off event
            const noteOffResponse = new NoteEvent();
            noteOffResponse.player = self.playerType.AGENT;
            noteOffResponse.instrument = self.instrumentType.PIANO;
            noteOffResponse.type = self.noteType.NOTE_OFF;
            noteOffResponse.midi = lastNote.midi;
            noteOffResponse.velocity = lastNote.velocity;
            noteOffResponse.playAfter = {
                tick: self.delay,
                seconds: 0,
            };
            noteList.push(noteOffResponse);
            lastNote = null;
        }
    }


    const actualPeriod = timeDiff;
    const actualBPM = 60 / (actualPeriod / 1000) / self.config.clockSettings.ticksPerBeat;
    console.log(actualBPM);
    self.param_writer.enqueue_change(3, actualBPM);

    message[self.messageType.NOTE_LIST] = noteList;
    return message;
}
