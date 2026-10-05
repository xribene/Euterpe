import {
    euterpeNoteToBachDuetNote,
    bachDuetNoteToEuterpeNote,
    euterpeTickToBachDuetTick,
    bachDuetInference,
    bachDuetToken,
    primeNetwork,
} from './bachDuetUtils.js';
import {logEvent, logTick} from './sessionLog.js';
import {ImitationMode} from './imitation.js';

/**
 * Processes a clock event and returns a message with the agent's output notes.
 * @param {Object} content - The clock event content.
 * @return {Promise<Object>} - The message with the agent's output notes.
 */
export async function processClockEvent(content) {
    // userQuantizedNotes is an array of NoteEvent objects
    // it contains note_on and note_hold events for the current tick
    const numUserNotes = content.userQuantizedNotes.length;
    if (numUserNotes > 1) {
        console.error('BachDuet can only handle monophonic input. ' +
        'Make sure to set polyphony.input:1 in config.yaml');
    }
    // If there is no user note, then we have a rest
    // BachDuet expects the 'rest' token/note
    let userInputBD;
    if (numUserNotes == 0) {
        // self.restNote has been initialized in initAgent_hook.js
        userInputBD = self.restNote;
    } else {
        // utility function to convert Euterpe's note to BachDuet's note
        // i.e MIDI note 60 onset becomes '60_1'
        userInputBD = euterpeNoteToBachDuetNote(content.userQuantizedNotes[0]);
    }
    // Convert the tick from Euterpe's format to BachDuet's format
    const tickBD = euterpeTickToBachDuetTick(content.tick);

    // Turn-taking (turnTaking.js): while BachDuet listens its choices are muted, and its own-voice input is
    // what the seeding says (null: its previous choice, as without turn-taking)
    const turn = self.turnTaking.hear(userInputBD.midi, userInputBD.artic, content.tick);
    if (turn.input) self.lastBachDuetNote = bachDuetToken(turn.input.midi, turn.input.artic);
    self.lastSoundedNote ??= self.lastBachDuetNote;
    // no imitation answers while listening (the motif heard is kept: BachDuet can answer it right at its entry)
    const imitationLevel = turn.listening ? 0 : (self.imitationLevel ?? 0);

    // Update the key estimate with what both voices sound at this tick (display only)
    self.keyEstimator.update(userInputBD.midi, self.lastSoundedNote.midi, content.tick);

    // Imitation mode: does BachDuet answer the user's motif now? (imitation.js; off when the slider is 0)
    self.imitation ??= new ImitationMode({style: self.imitationStyle ?? 'hybrid', v2: true});
    const logLength = self.imitation.log.length;
    const imitation = self.imitation.step({
        token2index: self.tokenIndexDict.midiArtic.token2index,
        userMidi: userInputBD.midi,
        userArtic: userInputBD.artic,
        agentToken: self.lastBachDuetNote.midiArticInd,
        agentMidi: self.lastBachDuetNote.midi,
        key: self.keyEstimator.current ?? 0,
        localTick: content.tick,
        level: imitationLevel,
        u: Math.random(),
    });
    for (const [, event, info] of self.imitation.log.slice(logLength)) {
        if (event !== 'deviation' && event !== 'veto') logEvent('imitation', {event, info});
    }

    // Neural network inference (uses self.lastBachDuetNote as BachDuet's current note)
    const choice = await bachDuetInference(userInputBD, tickBD, content.tick, imitation, imitationLevel);

    // What sounds (a rest while listening) and what BachDuet's own voice gets at the next tick
    const {sounded, fed, event, resetState} = self.turnTaking.decide(choice);
    if (event) {
        logEvent('turn', {event, key: self.keyEstimator.getKey()});
        console.log(`BachDuet ${event === 'join' ? 'joins' : 'stops and listens'} (tick ${content.tick})`);
    }
    if (resetState) {
        // re-entry 'reset': start the next phrase from the primed state for the key BachDuet hears now
        primeNetwork(self.keyEstimator.getKey() ?? self.startKey, 'turn-taking');
    }
    const currentBachDuetNote = {...bachDuetToken(sounded.midi, sounded.artic),
        entropy: choice.entropy, pChosen: choice.pChosen};
    logTick([content.tick, userInputBD.midi, userInputBD.artic, currentBachDuetNote.midi, currentBachDuetNote.artic,
        +currentBachDuetNote.entropy.toFixed(3), +currentBachDuetNote.pChosen.toFixed(3)]);

    // Convert the bachDuet's note output to Euterpe's note format
    const agentOutputNoteList = bachDuetNoteToEuterpeNote(currentBachDuetNote);

    // Update the last notes (they'll be used in the next tick)
    self.lastSoundedNote = currentBachDuetNote;
    self.lastBachDuetNote = fed.midi === choice.midi && fed.artic === choice.artic ? choice :
        bachDuetToken(fed.midi, fed.artic);

    // Add your messages to Euterpe here
    const message = {
        [self.messageType.NOTE_LIST]: agentOutputNoteList,
    };
    const key = self.keyEstimator.getKey();
    if (key !== self.shownKey) {
        self.shownKey = key;
        message[self.messageType.LABEL] = key;
        message[self.messageType.KEY] = key;
    }

    return message;
}
