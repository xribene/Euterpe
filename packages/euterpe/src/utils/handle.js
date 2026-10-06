/**
 * window.__euterpe: a stable handle on the running UI for tests, scripts and coding agents, so they don't
 * reach into Vue internals or click through the UI. Installed by Euterpe.vue once the agent worker exists.
 *
 *   await __euterpe.whenReady()      // the agent loaded and the permissions are granted
 *   __euterpe.enter()                // what the start button does
 *   __euterpe.startClock() / stopClock(); __euterpe.clockRunning; __euterpe.tick; __euterpe.bpm; setBPM(120)
 *   __euterpe.params; __euterpe.setParam('slider', 1, 40)   // widgets, as the agent's ctx.params sees them
 *   __euterpe.noteOn(60) / noteOff(60)                     // a user note, as from the laptop keyboard
 *   __euterpe.agentMessages(since)   // what the agent sent: [{t, hookType, message}], numbered from 0
 */
import {NoteEvent} from './NoteEvent.js';
import {Midi} from '@tonaljs/tonal';

const MAX_MESSAGES = 2000;

/**
 * @param {Object} vm - The Euterpe view.
 */
export function installHandle(vm) {
    const messages = [];
    let dropped = 0; // messages already removed from the front
    vm.agent.addEventListener('message', (e) => {
        messages.push({t: performance.now(), hookType: e.data?.hookType, message: e.data?.message});
        if (messages.length > MAX_MESSAGES) {
            messages.shift();
            dropped++;
        }
    });
    const store = vm.$store;
    const userNote = (midi, type, velocity) => {
        const note = new NoteEvent();
        note.player = vm.playerType.HUMAN;
        note.instrument = vm.instrumentType.PIANO;
        note.eventSource = vm.eventSourceType.KEYBOARD;
        note.name = Midi.midiToNoteName(midi, {sharps: true});
        note.type = type;
        note.channel = 140;
        note.midi = midi;
        note.velocity = velocity;
        note.createdAt = {seconds: performance.now(), tick: store.getters.getGlobalTickDelayed};
        note.playAfter = {seconds: 0, tick: 0};
        note.duration = null;
        vm.processUserNoteEvent(note);
    };

    const handle = {
        config: vm.config,
        get ready() {
            return Boolean(vm.agentLoaded && vm.permissionsGranted);
        },
        whenReady(timeoutMs = 180000) {
            return new Promise((resolve, reject) => {
                const t0 = performance.now();
                const poll = () => {
                    if (handle.ready) resolve(true);
                    else if (performance.now() - t0 > timeoutMs) reject(new Error('Euterpe: agent not ready'));
                    else setTimeout(poll, 50);
                };
                poll();
            });
        },
        get entered() {
            return vm.$refs.mainContent?.style.display === 'block';
        },
        enter() {
            if (!handle.entered) vm.entryProgram();
        },
        get clockRunning() {
            return Boolean(vm.localSyncClockStatus);
        },
        startClock() {
            if (!vm.localSyncClockStatus) vm.toggleClock();
        },
        stopClock() {
            if (vm.localSyncClockStatus) vm.toggleClock();
        },
        get tick() {
            return {local: store.getters.getLocalTick, global: store.getters.getGlobalTick};
        },
        get bpm() {
            return vm.localBPM;
        },
        setBPM(bpm) {
            vm.bpmValueChanged(bpm);
        },
        // as ctx.params: sliders and switches by position, dropdowns and buttons by id
        get params() {
            return {
                slider: Object.fromEntries(vm.sliders.map((s, i) => [i + 1, s.value])),
                switch: Object.fromEntries(vm.switches.map((s, i) => [i + 1, s.status])),
                dropdown: Object.fromEntries(vm.dropdowns.map((d) => [d.id, d.value])),
            };
        },
        setParam(kind, id, value) {
            if (kind === 'slider') vm.sliders[id - 1].value = value;
            else if (kind === 'switch') vm.switches[id - 1].status = Boolean(value);
            else if (kind === 'dropdown') vm.dropdowns.find((d) => d.id === id).value = value;
            else if (kind === 'button') vm.buttonAction(id);
            else throw new Error(`__euterpe.setParam: unknown widget kind "${kind}"`);
        },
        noteOn(midi, velocity = 127) {
            userNote(midi, vm.noteType.NOTE_ON, velocity);
        },
        noteOff(midi) {
            userNote(midi, vm.noteType.NOTE_OFF, 127);
        },
        // the agent's messages from number `since` on (numbers count from the first message ever received)
        agentMessages(since = 0) {
            return messages.slice(Math.max(0, since - dropped));
        },
        get agentMessageCount() {
            return dropped + messages.length;
        },
    };
    window.__euterpe = handle;
}
