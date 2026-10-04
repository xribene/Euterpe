import {clampMidi} from '@/utils/math.js';
import {NoteEvent} from '@/utils/NoteEvent.js';
import {chooseToken, updateSide} from './bachDuetDecoding.js';

const BAR = [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, -1];
const BEAT = [0, -2, -1, -2, 0, -2, -1, -2, 0, -2, -1, -2, 0, -2, -1, -2];
const ACCENT =[0, -3, -2, -3, -2, -4, -3, -4, -1, -3, -2, -3, -2, -4, -3, -4];
// Penalty for being on the wrong side of the user, active whenever anticipation is on
const CROSS_PENALTY = 8;


function createNote(midi, type) {
    const noteOn = new NoteEvent();
    noteOn.player = self.playerType.AGENT;
    noteOn.instrument = self.instrumentType.PIANO;
    noteOn.type = type;
    noteOn.midi = midi;
    noteOn.velocity = 127;
    // Play it instantly
    noteOn.playAfter = {
        tick: 1,
        seconds: 0,
    };
    return noteOn;
}

/**
 * Converts a tick from Euterpe to a tick in BachDuet.
 * @param {number} tick - The tick to convert.
 * @return {number} The converted tick.
 */
export function euterpeTickToBachDuetTick(tick) {
    const rhythmToken = BAR[tick].toString() + '_' +
                        BEAT[tick].toString() + '_' +
                        ACCENT[tick].toString();
    return self.tokenIndexDict.rhythm.token2index[rhythmToken];
}


/**
 * Converts a note from Euterpe to a note in BachDuet.
 * @param {NoteEvent} noteEvent - The note to convert.
 * @return {Object} The converted note.
 */
export function euterpeNoteToBachDuetNote(noteEvent) {
    let artic;
    if (noteEvent.type == self.noteType.NOTE_HOLD) {
        artic = 0;
    } else if (noteEvent.type == self.noteType.NOTE_ON) {
        artic = 1;
    }
    const midi = clampMidi(noteEvent.midi, 28, 94);
    const midiArtic = midi.toString() + '_' + artic.toString();
    const midiArticInd = self.tokenIndexDict.midiArtic.token2index[midiArtic];
    return {
        midi: midi,
        artic: artic,
        midiArticInd: midiArticInd,
        cpc: noteEvent.midi % 12,
    };
}

/**
 * Converts a note from BachDuet to a list of MICP NoteEvents.
 * @param {Object} bachDuetNote - The note to convert.
 * @return {NoteEvent} The converted note.
 */
export function bachDuetNoteToEuterpeNote(bachDuetNote) {
    const noteList = [];
    if (bachDuetNote.artic == 1) {
        // BachDuet generated a new note_on event
        // so we first need to send a note_off event for the previous note
        // unless the previous note was a rest.
        if (self.lastBachDuetNote.midi != 0) {
            noteList.push(createNote(self.lastBachDuetNote.midi, self.noteType.NOTE_OFF));
        }
        if (bachDuetNote.midi != 0) {
        // Now we create the new note_on event
            noteList.push(createNote(bachDuetNote.midi, self.noteType.NOTE_ON));
        }
    } else if (bachDuetNote.artic == 0) {
        // check if the last note had the same midi.
        // if yes, then we have a continuation don't send anything back to Euterpe
        // if no, then BachDuet made a mistake and generated a 'hold' version
        // of the note without previously generating a 'note on' version.
        // In this case we send a 'note on' event to Euterpe
        if (self.lastBachDuetNote.midi != bachDuetNote.midi) {
            if (self.lastBachDuetNote.midi != 0) {
                noteList.push(createNote(self.lastBachDuetNote.midi, self.noteType.NOTE_OFF));
            }
            noteList.push(createNote(bachDuetNote.midi, self.noteType.NOTE_ON));
        }
    }
    return noteList;
}

/**
 * One step of the network for one stream (BachDuet itself, or the role-swapped copy that
 * predicts the user). Returns the logits and the stream's new LSTM states; the old ones are freed.
 * @param {Array<Tensor>} states - [h1, c1, h2, c2]
 * @param {Array<number>} midiPair - midiArtic indices [this stream's voice, the other voice]
 * @param {Array<number>} cpcPair - pitch classes [this stream's voice, the other voice]
 * @param {number} tickBD - BachDuet rhythm token index
 * @return {{logits: Float32Array, states: Array<Tensor>}}
 */
function networkStep(states, midiPair, cpcPair, tickBD) {
    let logits;
    // tf.tidy frees every intermediate tensor; only the returned new states are kept
    const newStates = tf.tidy(() => {
        const exodos = self.modelEmb.predict([
            tf.tensor2d([midiPair]), tf.tensor2d([cpcPair]), tf.tensor2d([[tickBD]])]);
        const embMidi = exodos[0];
        const embCpc = exodos[1];
        const embRhy = exodos[2];
        const embMidiC = tf.concat([embMidi.slice([0, 0, 0], [1, 1, 150]),
            embMidi.slice([0, 1, 0], [1, 1, 150])], 2);
        const embCpcC = tf.concat([embCpc.slice([0, 0, 0], [1, 1, 150]),
            embCpc.slice([0, 1, 0], [1, 1, 150])], 2);
        const totalInp = tf.concat([embMidiC, embCpcC, embRhy], 2);
        const out = self.modelLstm.predict([totalInp, ...states]);
        logits = out[0].dataSync().slice();
        return out.slice(1);
    });
    tf.dispose(states);
    return {logits, states: newStates};
}

/**
 * The BachDuet inference: runs BachDuet and the role-swapped stream for this tick and
 * chooses BachDuet's next note (see bachDuetDecoding.js).
 * @param {Object} userNote - the user's note at this tick, in BachDuet format
 * @param {number} tickBD - BachDuet rhythm token index
 * @param {number} tick - Euterpe's tick in the measure (0-15 on the 16th grid)
 * @return {Object} BachDuet's next note
 */
export function bachDuetInference(userNote, tickBD, tick) {
    const last = self.lastBachDuetNote;
    const agent = networkStep(self.agentStates,
        [last.midiArticInd, userNote.midiArticInd], [last.cpc, userNote.cpc], tickBD);
    self.agentStates = agent.states;
    // The swapped stream always runs, so it is up to date whenever anticipation is turned on
    const swap = networkStep(self.swapStates,
        [userNote.midiArticInd, last.midiArticInd], [userNote.cpc, last.cpc], tickBD);
    self.swapStates = swap.states;

    const agentPitch = last.midi !== 0 ? last.midi : null;
    const userPitch = userNote.midi !== 0 ? userNote.midi : null;
    self.side = updateSide(self.side, userPitch);
    const midiArticInd = chooseToken({
        tokens: self.tokens,
        logits: agent.logits,
        swapLogits: swap.logits,
        agentPitch,
        userPitch,
        temperature: self.temperature / 100,
        antLam: self.anticipation,
        crossLam: self.anticipation > 0 ? CROSS_PENALTY : 0,
        side: self.side,
        restBias: self.restBias,
        // BachDuet's note is played on the next tick
        weakStep: (tick + 1) % 2 === 1,
    });
    const [midi, artic] = self.tokens[midiArticInd];
    const cpc = (midi === 0) ? 12 : midi % 12;
    return {midi: midi,
        artic: artic,
        cpc: cpc,
        midiArticInd: midiArticInd,
    };
}

const PITCH_CLASSES = {C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11};
const SHARP_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

/**
 * 'Db major', 'C♯ minor', 'F# major' ... -> the name used in primedStates.json ('C# major')
 * @param {string} label
 * @return {string|null}
 */
export function canonicalKeyName(label) {
    const m = /^\s*([A-G])\s*([#♯b♭]?)\s*(major|minor)/i.exec(label ?? '');
    if (!m) return null;
    const accidental = {'#': 1, '♯': 1, 'b': -1, '♭': -1}[m[2]] ?? 0;
    const pc = (PITCH_CLASSES[m[1].toUpperCase()] + accidental + 12) % 12;
    return `${SHARP_NAMES[pc]} ${m[3].toLowerCase()}`;
}

/**
 * Primed LSTM states for a starting key and voice (the voice the USER starts on), or null.
 * The role-swapped stream uses the state primed for the other voice.
 * @param {string} keyLabel
 * @param {string} voice - 'upper' or 'lower'
 * @return {{agent: Array<Float32Array>, swap: Array<Float32Array>}|null}
 */
function primedStatesFor(keyLabel, voice) {
    const primed = self.primedStates;
    if (!primed) return null;
    const key = canonicalKeyName(keyLabel);
    const find = (v) => primed.entries.findIndex((e) => e.key === key && e.voice === v);
    const iAgent = find(voice);
    const iSwap = find(voice === 'upper' ? 'lower' : 'upper');
    if (iAgent < 0 || iSwap < 0) return null;
    const size = primed.stateSize;
    const vectors = (i) => [0, 1, 2, 3].map((k) => primed.data.subarray((i * 4 + k) * size, (i * 4 + k + 1) * size));
    return {agent: vectors(iAgent), swap: vectors(iSwap)};
}

/**
 * Resets the BachDuet state: primed for the chosen starting key and voice when available,
 * random otherwise. This only sets where BachDuet starts from; it follows the user afterwards.
 */
export function resetBachDuetState() {
    tf.dispose([...(self.agentStates ?? []), ...(self.swapStates ?? [])]);
    // The user plays the upper voice, BachDuet the lower one
    const primed = primedStatesFor(self.startKey, 'upper');
    if (primed) {
        console.log(`reseting state: primed for ${self.startKey}`);
        self.agentStates = primed.agent.map((v) => tf.tensor2d(v, [1, v.length]));
        self.swapStates = primed.swap.map((v) => tf.tensor2d(v, [1, v.length]));
    } else {
        console.log('reseting state: random');
        self.agentStates = [0, 1, 2, 3].map(() => tf.randomNormal([1, 600]));
        self.swapStates = [0, 1, 2, 3].map(() => tf.randomNormal([1, 600]));
    }
    // BachDuet starts below the user (-1 below, +1 above)
    self.side = -1;
}
