import {clampMidi} from '@/utils/math.js';
import {NoteEvent} from '@/utils/NoteEvent.js';
import {chooseToken, updateSide} from './bachDuetDecoding.js';
import {logEvent} from './sessionLog.js';
import {GAP_QUANTILES, ImitationMode} from './imitation.js';

const BAR = [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, -1];
const BEAT = [0, -2, -1, -2, 0, -2, -1, -2, 0, -2, -1, -2, 0, -2, -1, -2];
const ACCENT =[0, -3, -2, -3, -2, -4, -3, -4, -1, -3, -2, -3, -2, -4, -3, -4];
// Penalty for being on the wrong side of the user, active whenever anticipation is on
const CROSS_PENALTY = 8;
// Counterpoint terms, active whenever anticipation is on (chosen with bdv2's counterpoint eval, see
// COUNTERPOINT.md in xribene/bachduet-v2): penalty for parallel 5ths/8ves with the user's predicted motion,
// and twice the anticipation weight when the next step is beat 1 or 3
const PARALLEL_PENALTY = 8;
const STRONG_BEAT_MULT = 2;


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
    // what BachDuet sounds now (with turn-taking this can differ from its own-voice input, self.lastBachDuetNote)
    const last = self.lastSoundedNote ?? self.lastBachDuetNote;
    if (bachDuetNote.artic == 1) {
        // BachDuet generated a new note_on event
        // so we first need to send a note_off event for the previous note
        // unless the previous note was a rest.
        if (last.midi != 0) {
            noteList.push(createNote(last.midi, self.noteType.NOTE_OFF));
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
        if (last.midi != bachDuetNote.midi) {
            if (last.midi != 0) {
                noteList.push(createNote(last.midi, self.noteType.NOTE_OFF));
            }
            noteList.push(createNote(bachDuetNote.midi, self.noteType.NOTE_ON));
        }
    }
    return noteList;
}

/**
 * A BachDuet note object {midi, artic, cpc, midiArticInd} for a pitch (0 = rest) and articulation.
 * @param {number} midi
 * @param {number} artic - 1 new note, 0 held (a rest is always '0_1')
 * @return {Object}
 */
export function bachDuetToken(midi, artic) {
    const token2index = self.tokenIndexDict.midiArtic.token2index;
    if (!midi) return {midi: 0, artic: 1, cpc: 12, midiArticInd: token2index['0_1']};
    return {midi, artic, cpc: midi % 12, midiArticInd: token2index[`${midi}_${artic}`]};
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
 * One step of both streams, BachDuet's and the role-swapped one, with whichever network is loaded: a TF.js
 * LSTM (self.agentStates / self.swapStates = [h1, c1, h2, c2], synchronous) or the ONNX transformer
 * (self.transformerState: both streams' attention caches over their token histories, one batched run).
 * @param {Array<number>} midiPair - midiArtic indices [BachDuet's current note, the user's note]
 * @param {Array<number>} cpcPair - their pitch classes
 * @param {number} tickBD - BachDuet rhythm token index
 * @return {Promise<{agent: {logits: Float32Array}, swap: {logits: Float32Array}}>}
 */
async function streamsStep(midiPair, cpcPair, tickBD) {
    if (self.modelKind === 'transformer') {
        const [agentLogits, swapLogits] = await self.transformer.step(self.transformerState,
            [midiPair[0], midiPair[1], cpcPair[0], cpcPair[1], tickBD],
            [midiPair[1], midiPair[0], cpcPair[1], cpcPair[0], tickBD]);
        return {agent: {logits: agentLogits}, swap: {logits: swapLogits}};
    }
    const agent = networkStep(self.agentStates, midiPair, cpcPair, tickBD);
    self.agentStates = agent.states;
    const swap = networkStep(self.swapStates, [midiPair[1], midiPair[0]], [cpcPair[1], cpcPair[0]], tickBD);
    self.swapStates = swap.states;
    return {agent, swap};
}

// Frees the LSTM states and drops the transformer's
function disposeStates() {
    tf.dispose([...(self.agentStates ?? []), ...(self.swapStates ?? [])]);
    self.agentStates = null;
    self.swapStates = null;
    self.transformerState = null;
}

/**
 * The BachDuet inference: runs BachDuet and the role-swapped stream for this tick and
 * chooses BachDuet's next note (see bachDuetDecoding.js).
 * @param {Object} userNote - the user's note at this tick, in BachDuet format
 * @param {number} tickBD - BachDuet rhythm token index
 * @param {number} tick - Euterpe's tick in the measure (0-15 on the 16th grid)
 * @param {Object} [imitation] - {target, bonus} from ImitationMode.step()
 * @param {number} [imitationLevel] - the Imitation slider (0 while BachDuet listens, see turnTaking.js)
 * @return {Promise<Object>} BachDuet's next note
 */
export async function bachDuetInference(userNote, tickBD, tick, imitation = {target: -1, bonus: 0},
    imitationLevel = self.imitationLevel ?? 0) {
    const last = self.lastBachDuetNote;
    // The swapped stream always runs, so it is up to date whenever anticipation is turned on
    const {agent, swap} = await streamsStep(
        [last.midiArticInd, userNote.midiArticInd], [last.cpc, userNote.cpc], tickBD);

    const agentPitch = last.midi !== 0 ? last.midi : null;
    const userPitch = userNote.midi !== 0 ? userNote.midi : null;
    self.side = updateSide(self.side, userPitch);
    // Imitation mode (v2): while answering, the imitation picks the token itself (motif rhythm, pitch among the
    // onset tokens, counterpoint veto); -1 hands the choice back to the decoder
    const strongStep = (tick + 1) % 16 === 0 || (tick + 1) % 16 === 8;
    const imitationToken = self.imitation?.v2 ? self.imitation.select(agent.logits, self.tokens,
        self.tokenIndexDict.midiArtic.token2index, strongStep, imitationLevel,
        GAP_QUANTILES[self.modelName]) : -1;
    const midiArticInd = imitationToken >= 0 ? imitationToken : chooseToken({
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
        parLam: self.anticipation > 0 ? PARALLEL_PENALTY : 0,
        strongMult: STRONG_BEAT_MULT,
        // BachDuet's note is played on the next tick
        weakStep: (tick + 1) % 2 === 1,
        strongStep,
        // imitation mode (original version): the motif's token for the next tick gets a logit bonus (imitation.js)
        bonusToken: imitation.target,
        bonus: imitation.bonus,
    });
    const [midi, artic] = self.tokens[midiArticInd];
    const cpc = (midi === 0) ? 12 : midi % 12;
    // How sure the network itself was (before decoding): for the session log
    const {entropy, probability} = confidence(agent.logits, midiArticInd);
    return {midi: midi,
        artic: artic,
        cpc: cpc,
        midiArticInd: midiArticInd,
        entropy: entropy,
        pChosen: probability,
    };
}

// Entropy (nats) of softmax(logits) and the probability it gave to token `index`
function confidence(logits, index) {
    let max = -Infinity;
    for (const l of logits) if (l > max) max = l;
    let z = 0;
    for (const l of logits) z += Math.exp(l - max);
    let entropy = 0;
    for (const l of logits) {
        const p = Math.exp(l - max) / z;
        if (p > 0) entropy -= p * Math.log(p);
    }
    return {entropy, probability: Math.exp(logits[index] - max) / z};
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
/**
 * Puts the network (both streams) in its starting state for a key: the primed LSTM states / the transformer's
 * primer for that key, random LSTM states if there are none. Also used by turn-taking's 'reset' re-entry.
 * @param {string} keyLabel - e.g. 'E♭ major'
 * @param {string} why - for the console and the session log ('reset' or 'turn-taking')
 */
export function primeNetwork(keyLabel, why = 'reset') {
    disposeStates();
    // The user plays the upper voice, BachDuet the lower one
    const primed = self.modelKind === 'transformer' ? null : primedStatesFor(keyLabel, 'upper');
    let isPrimed;
    if (self.modelKind === 'transformer') {
        // the transformer's state is its token history: it starts with the 4-bar primer for the key
        // (fed through the model in the background; the next tick waits for it)
        self.transformerState = self.transformer.newState(canonicalKeyName(keyLabel), 'upper');
        isPrimed = self.transformerState.primed;
        console.log(`${why}: transformer, ${isPrimed ? `primed for ${keyLabel}` : 'empty history'}`);
    } else if (primed) {
        isPrimed = true;
        console.log(`${why}: state primed for ${keyLabel}`);
        self.agentStates = primed.agent.map((v) => tf.tensor2d(v, [1, v.length]));
        self.swapStates = primed.swap.map((v) => tf.tensor2d(v, [1, v.length]));
    } else {
        isPrimed = false;
        console.log(`${why}: random state`);
        self.agentStates = [0, 1, 2, 3].map(() => tf.randomNormal([1, 600]));
        self.swapStates = [0, 1, 2, 3].map(() => tf.randomNormal([1, 600]));
    }
    return isPrimed;
}

/**
 * Resets the BachDuet state: primed for the chosen starting key and voice when available,
 * random otherwise. This only sets where BachDuet starts from; it follows the user afterwards.
 * With turn-taking (turnTaking.js) BachDuet then listens first.
 * @param {Object} [o]
 * @param {boolean} [o.barReset] - the Reset button's bar restart: this tick is beat 1 of a new bar (logged, so
 *     saved sessions and replays know where the bar restarted)
 */
export function resetBachDuetState({barReset = false} = {}) {
    self.imitation = new ImitationMode({style: self.imitationStyle ?? 'hybrid', v2: true});
    const primed = primeNetwork(self.startKey, 'reseting state');
    logEvent('reset', {startKey: self.startKey, model: self.modelName, primed, ...(barReset ? {barReset} : {})});
    // BachDuet's own voice starts with a rest (what it sounds, self.lastSoundedNote, is ended by the next tick)
    if (self.tokenIndexDict) self.lastBachDuetNote = bachDuetToken(0, 1);
    if (self.turnTaking) {
        self.turnTaking.reset();
        logEvent('turn', {event: self.turnTaking.playing ? 'play' : 'listen', ...turnTakingSettings()});
    }
    // BachDuet starts below the user (-1 below, +1 above)
    self.side = -1;
    // The key display starts from the starting key and then follows the music
    if (self.keyEstimator) {
        self.keyEstimator.reset(self.startKey);
        self.shownKey = self.keyEstimator.getKey();
        postMessage({
            hookType: self.agentHookType.INIT_AGENT,
            message: {[self.messageType.LABEL]: self.shownKey, [self.messageType.KEY]: self.shownKey},
        });
    }
}

/** The turn-taking settings, for the session log. */
export function turnTakingSettings() {
    const tt = self.turnTaking;
    return tt ? {listenTicks: tt.listenTicks, stopTicks: tt.stopTicks, seeding: tt.seeding, reentry: tt.reentry} : {};
}
