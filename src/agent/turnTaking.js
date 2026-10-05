/**
 * Turn-taking for BachDuet (FolkDuet's "listen, join, drop out" behaviour, folkDuet.js on the folkduet branch).
 * Plain JS with no TF.js, so it runs in Node (tools/turn-taking/test_turnTaking.mjs) and is ported 1:1 to
 * bachduet-v2/bdv2/eval/turntaking.py (decision-level parity: tests/test_turntaking_parity.py there).
 *
 * Listening: BachDuet is silent (its SOUNDED output is a rest) until the user has played for `listenTicks`
 * (counted from their first note, rests included) with at least `minNotes` notes; then it joins on the next beat
 * (the next tick that is a multiple of `startEvery`). The network keeps running while it listens: it hears the
 * user live, and its own-voice input gets, depending on `seeding`:
 *   'rest'    - rest tokens;
 *   'octave'  - the user's line an octave lower (+12 instead when that would leave MIDI 28..94), tick by tick,
 *               as if BachDuet had been doubling the user (FolkDuet-style; context only, never sounded);
 *   'freerun' - its own predictions, fed back as usual but muted.
 * Playing: unchanged (decoder, imitation, ...); the network's raw choice is fed back as before.
 * Stop: when the user has been silent for `stopTicks`, BachDuet lets its sounding note end (holds of that note
 * still sound, at most `maxRing` ticks), then goes silent and listens again; it re-joins `listenTicks` after the
 * user plays again. `reentry` = 'keep' keeps the network state; 'reset' asks the host to reset it to the primed
 * state for the current key estimate at that moment.
 * listenTicks 0 = play from the start (the old behaviour; after a stop, re-join on the beat after the user's next
 * note); stopTicks 0 = never stop (the old behaviour). Both 0 = exactly the old behaviour.
 *
 * Per tick t (the host = processClockEvent_hook.js):
 *   const {input, joining} = tt.hear(userMidi, userArtic, tickInBar);   // input: own-voice token at t, or null
 *   ... network step with (input ?? BachDuet's previous choice, user), decoder -> choice for t+1 ...
 *   const {sounded, fed, event, resetState} = tt.decide(choice);        // sounded at t+1; fed back at t+1
 */

export const MIDI_MIN = 28;
export const MIDI_MAX = 94;
export const SEEDINGS = ['rest', 'octave', 'freerun'];
export const REENTRIES = ['keep', 'reset'];
const REST = {midi: 0, artic: 1};

/**
 * The user's note an octave lower for the 'octave' seeding (+12 if -12 leaves BachDuet's range).
 * @param {number} midi - > 0
 * @return {number}
 */
export function octaveBelow(midi) {
    return midi - 12 >= MIDI_MIN ? midi - 12 : midi + 12;
}

export class TurnTaking {
    /**
     * @param {Object} [o]
     * @param {number} [o.listenTicks=16] - how long the user plays before BachDuet joins (0 = from the start)
     * @param {number} [o.stopTicks=32] - user silence after which BachDuet drops out (0 = never)
     * @param {number} [o.minNotes=3] - notes the user must have played before BachDuet joins
     * @param {number} [o.startEvery=4] - BachDuet joins on a multiple of this tick (4 = a beat)
     * @param {string} [o.seeding='octave'] - own-voice input while listening: 'rest' | 'octave' | 'freerun'
     * @param {string} [o.reentry='keep'] - network state when BachDuet drops out: 'keep' | 'reset'
     * @param {number} [o.maxRing=16] - longest a note may go on after the stop threshold
     */
    constructor({listenTicks = 16, stopTicks = 32, minNotes = 3, startEvery = 4, seeding = 'octave',
        reentry = 'keep', maxRing = 16} = {}) {
        this.listenTicks = listenTicks;
        this.stopTicks = stopTicks;
        this.minNotes = minNotes;
        this.startEvery = startEvery;
        this.seeding = seeding;
        this.reentry = reentry;
        this.maxRing = maxRing;
        this.reset();
    }

    /** Back to the start (Reset, model switch): listening, or playing at once when listenTicks is 0. */
    reset() {
        this.playing = this.listenTicks <= 0;
        this.joining = false;
        this.silence = 0; // ticks the user has been silent
        this.prevUser = 0; // the user's previous pitch (0 = rest)
        this.ring = 0; // ticks BachDuet's note went on after the stop threshold
        this.lastSounded = {...REST};
        this.clearPhrase();
    }

    clearPhrase() {
        this.phraseStarted = false;
        this.phraseTicks = 0;
        this.phraseNotes = 0;
    }

    // user silence after which a phrase heard while listening is forgotten
    get listenResetTicks() {
        return this.stopTicks > 0 ? this.stopTicks : 32;
    }

    /**
     * Before the network step: hears the user at this tick and says what BachDuet's own voice gets as input.
     * @param {number} userMidi - 0 = rest
     * @param {number} userArtic - 1 new note, 0 held
     * @param {number} tick - 16th in the bar (0..15)
     * @return {{input: ?{midi: number, artic: number}, joining: boolean, listening: boolean}}
     *     input: the own-voice token for this tick (null = BachDuet's previous choice, as without turn-taking);
     *     joining: BachDuet joins now (its choice at this tick is the first one that sounds);
     *     listening: still listening after this tick (its choice will be muted)
     */
    hear(userMidi, userArtic, tick) {
        const onset = userMidi > 0 && (userArtic === 1 || userMidi !== this.prevUser);
        this.prevUser = userMidi;
        this.silence = userMidi > 0 ? 0 : this.silence + 1;
        this.joining = false;
        if (this.playing) return {input: null, joining: false, listening: false};
        let input = null;
        if (this.seeding === 'rest') input = {...REST};
        else if (this.seeding === 'octave') input = userMidi > 0 ? {midi: octaveBelow(userMidi), artic: onset ? 1 : 0} : {...REST};
        if (!this.phraseStarted && userMidi > 0) this.phraseStarted = true;
        if (this.phraseStarted) {
            this.phraseTicks++;
            if (onset) this.phraseNotes++;
            if (this.silence >= this.listenResetTicks) this.clearPhrase();
        }
        const minNotes = this.listenTicks > 0 ? this.minNotes : 1;
        if (this.phraseStarted && this.phraseTicks >= this.listenTicks && this.phraseNotes >= minNotes &&
            (tick + 1) % this.startEvery === 0) {
            this.playing = true;
            this.joining = true;
        }
        return {input, joining: this.joining, listening: !this.playing};
    }

    /**
     * After the decoder: what sounds at the next tick and what is fed back to the network.
     * @param {{midi: number, artic: number}} choice - BachDuet's choice for the next tick
     * @return {{sounded: {midi: number, artic: number}, fed: {midi: number, artic: number}, event: ?string,
     *     resetState: boolean}} event: 'join' | 'stop' | null; resetState: reset the network to the primed state
     *     for the current key now (reentry 'reset', at a stop); then `fed` is a rest
     */
    decide(choice) {
        let sounded;
        let event = null;
        let resetState = false;
        let fed = {midi: choice.midi, artic: choice.artic};
        if (!this.playing) {
            sounded = {...REST};
        } else if (!this.joining && this.stopTicks > 0 && this.silence >= this.stopTicks) {
            const last = this.lastSounded.midi;
            if (choice.artic === 0 && choice.midi > 0 && choice.midi === last && this.ring < this.maxRing) {
                // its note goes on
                this.ring++;
                sounded = {midi: choice.midi, artic: 0};
            } else {
                // the note ends: drop out and listen again
                this.playing = false;
                this.ring = 0;
                this.clearPhrase();
                sounded = {...REST};
                event = 'stop';
                if (this.reentry === 'reset') {
                    resetState = true;
                    fed = {...REST};
                }
            }
        } else {
            if (this.joining) event = 'join';
            this.ring = 0;
            // a held note that is not sounding (e.g. the first note after joining) sounds as a new note
            const artic = choice.midi > 0 && choice.artic === 0 && choice.midi !== this.lastSounded.midi ? 1 : choice.artic;
            sounded = {midi: choice.midi, artic};
        }
        this.lastSounded = sounded;
        return {sounded, fed, event, resetState};
    }
}
