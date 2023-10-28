import {NoteEvent} from './../../../src/utils/NoteEvent.js';
import {clamp} from './../../../src/utils/math.js';


/**
 * Hook for processing single user note events.
 * This hook is invoked every time a note/midi
 * event is received by the user.
 *
 * For this hook to be invoked, make sure that in `config.yaml`,
 * the following flags are set to true:
 * - `interactionMode.noteMode: true`
 * - `nodeModeSettings.gridBased.status: true`
 *
 * @param {NoteEvent} noteEvent - A `NoteEvent` object representing
 * the note/midi event received by the user.
 *
 * @returns {Object=} - An optional object containing output messages, if any,
 * to be sent to the user interface. If there is some output that needs to be
 * sent to the UI (e.g., a list of notes to be played), you can add it to a
 * dictionary and return it. If not, it's fine to not return anything.
 */
export function processNoteEvent(noteEvent) {
  // Euterpe expects a note list, even if it's a single note
  const noteList = [];
  let label = '';

  if (noteEvent.type == self.noteType.NOTE_ON) {
    // First we get the midi value of the note the user played
    const inputMidi = noteEvent.midi;
    // Then we estimate the midi the copycat will play
    let outputMidi = null;
    if (self.randomness == 0.0) {
      // If 0.0, then it just copies one octave lower
      outputMidi = inputMidi + self.pitchShift;
    } else {
      // If not, then it copies one octave lower with some randomness
      // that is controlled by the slider
      outputMidi = inputMidi - self.pitchShift + Math.floor(Math.random() * self.randomness/10);
    }
    // Set the range of outputMidi to be 21-108 (piano range)
    outputMidi = clamp(outputMidi, 21, 108);

    // Set the text for the TextBox widget
    label = outputMidi.toString();

    // Construct a new NoteEvent object
    const copycatNote = new NoteEvent();

    // The player is the agent
    copycatNote.player = self.playerType.AGENT;

    // The instrument is required for playback
    copycatNote.instrument = self.instrumentType.PIANO;

    // The type of the note is the same as the user's input (note_on or note_off)
    copycatNote.type = noteEvent.type;

    // The midi value is the one we estimated
    copycatNote.midi = outputMidi;

    // The velocity is the same as the user's input
    copycatNote.velocity = noteEvent.velocity;
    // Play it instantly
    copycatNote.playAfter = {
      tick: 0,
      seconds: self.delay,
    },

    // Push the note to the list of notes to be sent to the UI
    noteList.push(copycatNote);

    // We store the mapping of the user's note to the agent's note
    // in the userToAgentNoteMapping dictionary (defined in agent.js)
    // Later, when we receive the note-off event, we can use this mapping
    // to know which note to turn off
    self.userToAgentNoteMapping[noteEvent.midi] = [outputMidi];
  } else {
    const midisToTurnOff = self.userToAgentNoteMapping[noteEvent.midi];
    for (const midiOff of midisToTurnOff) {
      // Construct a new NoteEvent object
      const copycatNote = new NoteEvent();

      // The player is the agent
      copycatNote.player = self.playerType.AGENT;

      // The instrument is required for playback
      copycatNote.instrument = self.instrumentType.PIANO;

      // The type of the note is the same as the user's input (note_on or note_off)
      copycatNote.type = noteEvent.type;

      // The midi value is the one we estimated
      copycatNote.midi = midiOff;

      // The velocity is the same as the user's input
      copycatNote.velocity = noteEvent.velocity;
      // Play it instantly
      copycatNote.playAfter = {
        tick: 0,
        seconds: self.delay,
      };
      noteList.push(copycatNote);
    }
  }

  /*
    At this stage, the worker has finished processing the note event.
    If there is some output that needs to be sent to the UI
    (e.g., a list of notes to be played), you can add it to a dictionary
    and return it. If not, it's fine to not return anything.
    */
  const message = {};
  message[self.messageType.NOTE_LIST] = noteList;
  if (label !== '') {
    message[self.messageType.LABEL] = label;
  }
  return message;
}
