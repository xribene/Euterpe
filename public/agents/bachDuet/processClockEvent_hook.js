import {
    euterpeNoteToBachDuetNote,
    bachDuetNoteToEuterpeNote,
    euterpeTickToBachDuetTick,
    bachDuetInference,
    resetBachDuetState
    } from './bachDuetUtils.js';

function processClockEvent(content) {
    
    let startTime = performance.now(); // Do not remove
    let numUserNotes = content.humanQuantizedInput.length;
    if (numUserNotes > 1) {
        console.error("BachDuet can only handle monophonic input. Make sure to set polyphony.input:1 in config.yaml");
    }
    // If there is no user note, BachDuet expects the a 'rest' token/note
    let userInput_bd;
    if (numUserNotes == 0) {
        userInput_bd = self.restNote;
    } else {
        userInput_bd = euterpeNoteToBachDuetNote(content.humanQuantizedInput[0]);
    }
    // Convert the tick from Euterpe's format to BachDuet's format
    let tick_bd = euterpeTickToBachDuetTick(content.tick);

    // Prepare the input tensors for the neural network
    let midiInput_t = tf.tensor2d([[self.lastBachDuetNote.midiArticInd, userInput_bd.midiArticInd]]);
    let cpcInput_t = tf.tensor2d([[self.lastBachDuetNote.cpc, userInput_bd.cpc]]);
    let tick_t = tf.tensor2d([[tick_bd]]);

    // Neural network inference
    let currentBachDuetNote = bachDuetInference(midiInput_t, cpcInput_t, tick_t);
    
    // Convert the bachDuet's note output to Euterpe's note format
    let agentOutputNoteList = bachDuetNoteToEuterpeNote(currentBachDuetNote);
    
    // Update the last note (it'll be used in the next tick)
    self.lastBachDuetNote = currentBachDuetNote;

    let endTime = performance.now(); // Do not remove
    postMessage({
        hookType: self.agentHookType.CLOCK_EVENT, // Do not modify
        message:{
            [self.messageType.CLOCK_TIME]: content.tick, // Do not modify
            [self.messageType.INFERENCE_TIME]: endTime - startTime, // Do not modify
            // Add your messages here
            [self.messageType.NOTE_LIST]: agentOutputNoteList
        },
    })
}

// Here add any other functions that you need
// to be accessible from other files i.e. initAgent_hook.js
export {processClockEvent, resetBachDuetState};