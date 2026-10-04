/**
 * "Imitation mode": now and then BachDuet answers the user's motif in imitation, like the voices of an invention.
 * Plain JS, exact port of ImitationMode in bachduet-v2/bdv2/eval/imitation.py (see bachduet-v2/IMITATION.md).
 *
 * Trigger (only when the next tick is a beat, the cooldown is over and the level is > 0): the user's last 8
 * (else 4) ticks start with a new note on a beat and contain at least 4 new notes. Then, with probability
 * level / 10, BachDuet answers that motif delayed by the window length (so the answer starts on the next tick),
 * transposed an octave, 5th or 4th below in the current key, displaced by octaves so that it stays in BachDuet's
 * register: the candidate whose mean pitch (and first note) is closest to BachDuet's recent register, below the
 * user's motif and current note, within MIDI 28-94. While answering, the motif's token for the next tick gets a logit bonus (3 x level);
 * the network can still choose something else (two such deviations end the answer).
 */

const SCALES = {major: [0, 2, 4, 5, 7, 9, 11], minor: [0, 2, 3, 5, 7, 8, 10]};
const COOLDOWN_STEPS = 32; // two bars between imitations
// candidate transpositions (scale steps): octave / 2 octaves, 5th / 12th / 19th, 4th / 11th / 18th below
const SHIFTS = [-7, -14, -4, -11, -18, -3, -10, -17];
const REGISTER_STEPS = 32; // BachDuet's register = mean of its sounding pitches over the last 2 bars
const MIDI_MIN = 28;
const MIDI_MAX = 94;

const floorDiv = (a, b) => Math.floor(a / b);
const mod = (a, b) => ((a % b) + b) % b;

/**
 * Global diatonic degree of a MIDI pitch in a key (k = tonic pc + 12 * minor) and its chromatic alteration.
 * @return {Array<number>} [degree, alteration]
 */
export function degree(pitch, key) {
    const tonic = key % 12;
    const scale = key >= 12 ? SCALES.minor : SCALES.major;
    const rel = pitch - tonic;
    const octave = floorDiv(rel, 12);
    const r = mod(rel, 12);
    let i = 0;
    for (let j = 0; j < scale.length; j++) if (scale[j] <= r) i = j;
    return [octave * 7 + i, r - scale[i]];
}

/** Move a pitch by `steps` scale steps in the key, keeping its chromatic alteration. */
export function diatonicShift(pitch, steps, key) {
    const tonic = key % 12;
    const scale = key >= 12 ? SCALES.minor : SCALES.major;
    const [g, alt] = degree(pitch, key);
    const g2 = g + steps;
    return tonic + 12 * floorDiv(g2, 7) + scale[mod(g2, 7)] + alt;
}

export class ImitationMode {
    constructor() {
        this.reset();
    }

    reset() {
        this.t = -1;
        this.user = []; // [midi, artic] per tick
        this.agent = []; // BachDuet's sounding pitch per tick (0 = silent)
        this.active = null; // {motif, start, shift, key}
        this.cooldownUntil = 0;
        this.pending = -1;
        this.deviations = 0;
        this.log = []; // [tick, event, info]
    }

    // 3 x level: at low levels the network can still refuse a target (it refuses onsets on off-beat 16ths by a
    // median of ~21 logits); at level 10 (bonus 30) the answer is played almost note for note.
    static bonusFor(level) {
        return 3.0 * level;
    }

    /**
     * One tick, before BachDuet chooses its next token.
     * @param {Object} p
     * @param {Object} p.token2index - tokenIndexDict.midiArtic.token2index
     * @param {number} p.userMidi - the user's note at this tick (0 = rest)
     * @param {number} p.userArtic - 1 new note, 0 held
     * @param {number} p.agentToken - BachDuet's token sounding at this tick
     * @param {number} p.agentMidi - its pitch (0 = rest)
     * @param {number} p.key - current key estimate (tonic pc + 12 * minor)
     * @param {number} p.localTick - position in the bar, 0-15
     * @param {number} p.level - the Imitation slider, 0-10
     * @param {number} p.u - a uniform random number in [0, 1)
     * @return {{target: number, bonus: number}} target token (-1: none) and its logit bonus
     */
    step({token2index, userMidi, userArtic, agentToken, agentMidi, key, localTick, level, u}) {
        this.t += 1;
        const t = this.t;
        this.user.push([userMidi, userArtic]);
        if (this.user.length > 64) this.user = this.user.slice(-64);
        this.agent.push(agentMidi);
        if (this.agent.length > REGISTER_STEPS) this.agent = this.agent.slice(-REGISTER_STEPS);
        // did the network follow the previous target?
        if (this.active !== null && this.pending >= 0 && agentToken !== this.pending) {
            this.deviations += 1;
            this.log.push([t, 'deviation', this.deviations]);
            if (this.deviations >= 2) {
                this.log.push([t, 'abort', 'deviations']);
                this.active = null;
                this.cooldownUntil = t + 1 + COOLDOWN_STEPS;
            }
        }
        this.pending = -1;
        if (level <= 0) {
            this.active = null;
            return {target: -1, bonus: 0};
        }
        if (this.active === null && t + 1 >= this.cooldownUntil && (localTick + 1) % 4 === 0) {
            for (const W of [8, 4]) {
                if (this.user.length < W) continue;
                const win = this.user.slice(-W);
                const onsets = win.filter(([m, a]) => m > 0 && a === 1).length;
                if (win[0][0] > 0 && win[0][1] === 1 && onsets >= 4) {
                    if (u < level / 10) this.start(win, t + 1, agentMidi, userMidi, key);
                    break;
                }
            }
        }
        if (this.active === null) return {target: -1, bonus: 0};
        const a = this.active;
        const k = t + 1 - a.start;
        if (k >= a.motif.length) {
            this.log.push([t, 'end', a.motif.length]);
            this.active = null;
            this.cooldownUntil = t + 1 + COOLDOWN_STEPS;
            return {target: -1, bonus: 0};
        }
        const [m, artic] = a.motif[k];
        const midi = m > 0 ? diatonicShift(m, a.shift, a.key) : 0;
        const target = midi === 0 ? token2index['0_1'] : (token2index[`${midi}_${artic}`] ?? -1);
        if (target < 0) {
            this.log.push([t, 'abort', 'range']);
            this.active = null;
            this.cooldownUntil = t + 1 + COOLDOWN_STEPS;
            return {target: -1, bonus: 0};
        }
        this.pending = target;
        return {target, bonus: ImitationMode.bonusFor(level)};
    }

    start(win, start, agentMidi, userMidi, key) {
        const motif = win.filter(([m]) => m > 0).map(([m]) => m);
        const mean = (v) => v.reduce((a, b) => a + b, 0) / v.length;
        const heard = this.agent.filter((p) => p > 0);
        const register = heard.length ? mean(heard) : (agentMidi > 0 ? agentMidi : mean(motif) - 12);
        const ref = agentMidi > 0 ? agentMidi : register;
        const ceiling = Math.min(...motif, ...(userMidi > 0 ? [userMidi] : []));
        let best = null;
        let bestCost = null;
        let fallback = null;
        let fallbackCost = null;
        for (const s of SHIFTS) {
            const pitches = motif.map((m) => diatonicShift(m, s, key));
            if (Math.min(...pitches) < MIDI_MIN || Math.max(...pitches) > MIDI_MAX) continue;
            const cost = Math.abs(mean(pitches) - register) + 0.5 * Math.abs(pitches[0] - ref);
            if (fallback === null || cost < fallbackCost) {
                fallback = s;
                fallbackCost = cost;
            }
            if (Math.max(...pitches) >= ceiling) continue; // stay below the user's motif / current note
            if (best === null || cost < bestCost) {
                best = s;
                bestCost = cost;
            }
        }
        if (best === null) best = fallback;
        if (best === null) return;
        this.active = {motif: win.map(([m, a]) => [m, a]), start, shift: best, key};
        this.deviations = 0;
        this.log.push([start - 1, 'start', {length: win.length, shift: best, key}]);
    }
}
