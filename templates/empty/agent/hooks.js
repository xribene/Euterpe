// @ts-check
// Your agent. Euterpe calls these hooks; every one is optional and may be async.
// ctx: ctx.config (the YAML files), ctx.params (widget values), ctx.noteOn / ctx.noteOff, ctx.send, ctx.monitor
import {defineAgent} from 'euterpe/agent';

export default defineAgent({
    // Once at startup: load models and data here. The start button appears when this resolves.
    async loadAlgorithm(ctx) {
        ctx.send({text: 'Loading...'});
    },

    // Every tick of the grid (config.yaml: gridBased). userQuantizedNotes: the user's notes on this tick.
    // Return the notes to play, e.g. [ctx.noteOn(60)] now, or [ctx.noteOn(60, {tick: 4})] four ticks from now.
    processClockEvent({tick, userQuantizedNotes}, ctx) {
        return [];
    },

    // Every note the user plays, as it happens (config.yaml: eventBased).
    processNoteEvent(noteEvent, ctx) {
    },

    // A widget in Settings changed (widgets.yaml). ctx.params.slider[1] etc. already hold the new values.
    updateParameter({kind, id, value}, ctx) {
        console.log(`${kind} ${id} = ${value}`);
    },
});
