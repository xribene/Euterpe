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

// ---- v2 (styles Exact / Contour / Hybrid): rhythm from the motif, pitch chosen among onset tokens, critic veto
const CONSONANT = [0, 3, 4, 7, 8, 9];
const MAJOR_SET = [0, 2, 4, 5, 7, 9, 11];
const MINOR_SET = [0, 2, 3, 5, 7, 8, 10, 11]; // natural + raised 6th/7th
const LOCAL_STEPS = 16; // local scale from the user's last bar
const WINDOW = 9; // contour candidates within +-9 semitones of BachDuet's register
const USER_STOP_STEPS = 4; // the user silent this long during an answer ends it
// Per-model calibration of the slider: log N(level) for levels 1..9 = the level/10 quantile of the gap
// (best onset logit - exact target logit) measured on sessions + inventions (bachduet-v2
// tools/imitation_calibrate.py), so a level accepts the same share of exact targets on every model; 10 accepts all.
export const GAP_QUANTILES = {
    'BachDuet 2018 (deployed)': [0.0, 0.0, 0.584, 1.413, 2.776, 3.676, 4.837, 6.571, 8.159],
    'BachDuet v2 (new)': [0.0, 0.0, 0.074, 0.557, 1.153, 1.627, 2.252, 3.213, 4.328],
    'BachDuet v2 chorales (m2)': [0.0, 0.033, 1.473, 3.246, 5.257, 7.073, 8.428, 10.047, 12.636],
    'Frankenstein chorales': [0.0, 0.0, 1.212, 2.465, 3.933, 5.395, 6.581, 8.688, 11.021],
    'RL cadence (long)': [0.0, 0.0, 0.993, 2.872, 4.909, 6.302, 7.826, 10.854, 13.33],
    'RL β 0.3': [0.0, 0.0, 0.637, 2.255, 3.657, 5.703, 7.108, 9.091, 11.639],
    'RL Frankenstein (best)': [0.0, 0.0, 0.444, 2.054, 4.016, 5.075, 7.19, 9.178, 11.69],
};
const DEFAULT_GAPS = [0.0, 0.0, 0.56, 1.736, 3.163, 4.582, 6.306, 8.229, 11.295];

function scaleSet(key) {
    const tonic = key % 12;
    return (key >= 12 ? MINOR_SET : MAJOR_SET).map((x) => (tonic + x) % 12).sort((a, b) => a - b);
}

function sizeClass(semitones) {
    const a = Math.abs(semitones);
    return a === 0 ? 0 : a <= 2 ? 1 : a <= 4 ? 2 : a <= 7 ? 3 : 4;
}

/** log N for a slider level: Infinity at 10. */
export function logThreshold(level, gaps) {
    if (level >= 10) return Infinity;
    const g = gaps ?? DEFAULT_GAPS;
    const i = Math.max(1, Math.min(9, Math.trunc(level))) - 1;
    return g[i];
}

const sign = (x) => (x > 0 ? 1 : x < 0 ? -1 : 0);
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
    /**
     * @param {Object} [options]
     * @param {string} [options.style='exact'] - v2 only: 'exact' | 'contour' | 'hybrid'
     * @param {boolean} [options.v2=false] - false: the original logit-bonus mode
     */
    constructor({style = 'exact', v2 = false} = {}) {
        this.style = style;
        this.v2 = v2;
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
        this.plan = null; // v2: [motif pitch, artic, previous motif onset pitch] for the next tick
        this.vetoes = 0;
        this.answerLast = 0; // v2: BachDuet's last answer onset pitch
        this.userSilent = 0;
        this.userOnsets = []; // the user's last two onset pitches
        this.counts = {exact: 0, contour: 0, veto: 0};
        this.key = 0;
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
        if (userMidi > 0 && userArtic === 1) this.userOnsets = [...this.userOnsets, userMidi].slice(-2);
        if (this.v2) return this.stepV2(t, userMidi, agentMidi, key, localTick, level, u);
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

    end(t, event, info) {
        this.log.push([t, event, info]);
        this.active = null;
        this.plan = null;
        this.cooldownUntil = t + 1 + COOLDOWN_STEPS;
    }

    // v2: decide the plan (motif position) for the next tick; the token is chosen later by select()
    stepV2(t, userMidi, agentMidi, key, localTick, level, u) {
        this.plan = null;
        this.key = key;
        if (level <= 0) {
            this.active = null;
            return {target: -1, bonus: 0};
        }
        if (this.active !== null) {
            this.userSilent = userMidi === 0 ? this.userSilent + 1 : 0;
            if (this.userSilent >= USER_STOP_STEPS) {
                this.end(t, 'abort', 'user stopped');
                return {target: -1, bonus: 0};
            }
        }
        if (this.active === null && t + 1 >= this.cooldownUntil && (localTick + 1) % 4 === 0) {
            for (const W of [8, 4]) {
                if (this.user.length < W) continue;
                const win = this.user.slice(-W);
                const onsets = win.filter(([m, a]) => m > 0 && a === 1).length;
                if (win[0][0] > 0 && win[0][1] === 1 && onsets >= 4) {
                    if (u < level / 10) {
                        this.start(win, t + 1, agentMidi, userMidi, key);
                        this.vetoes = 0;
                        this.answerLast = 0;
                        this.userSilent = 0;
                    }
                    break;
                }
            }
        }
        if (this.active === null) return {target: -1, bonus: 0};
        const a = this.active;
        const k = t + 1 - a.start;
        if (k >= a.motif.length) {
            this.end(t, 'end', a.motif.length);
            return {target: -1, bonus: 0};
        }
        const [m, artic] = a.motif[k];
        let prev = 0;
        for (let j = k - 1; j >= 0; j--) {
            const [pm, pa] = a.motif[j];
            if (pm > 0 && pa === 1) {
                prev = pm;
                break;
            }
        }
        this.plan = [m, artic, prev];
        return {target: -1, bonus: 0};
    }

    // The major scale covering most of the user's sounding ticks in the last bar (the key estimate's scale wins
    // ties); the key estimate's scale when the user played fewer than 4 sounding ticks.
    localScale() {
        const est = scaleSet(this.key);
        const counts = new Array(12).fill(0);
        let n = 0;
        for (const [m] of this.user.slice(-LOCAL_STEPS)) {
            if (m > 0) {
                counts[m % 12] += 1;
                n += 1;
            }
        }
        if (n < 4) return est;
        const score = (S) => S.reduce((acc, pc) => acc + counts[pc], 0);
        let bestSet = null;
        let best = -1;
        for (let tonic = 0; tonic < 12; tonic++) {
            const S = MAJOR_SET.map((x) => (tonic + x) % 12).sort((x, y) => x - y);
            const v = score(S);
            if (v > best) {
                bestSet = S;
                best = v;
            }
        }
        return score(est) >= best ? est : bestSet;
    }

    static snap(p, S, direction) {
        if (S.includes(p % 12)) return p;
        for (const q of (direction > 0 ? [p + 1, p - 1] : [p - 1, p + 1])) if (S.includes(mod(q, 12))) return q;
        return p;
    }

    // false if onset p makes a strong-beat dissonance with the user's current note, or a parallel 5th/8ve with
    // the user's last move (the user's previous note -> current note, BachDuet's current note -> p)
    criticOk(p, strong) {
        const u = this.user[this.user.length - 1][0];
        const a = this.agent[this.agent.length - 1];
        const ic = (x, y) => (Math.max(x, y) - Math.min(x, y)) % 12;
        if (strong && u > 0 && !CONSONANT.includes(ic(u, p))) return false;
        if (u > 0 && a > 0 && this.userOnsets.length === 2 && this.userOnsets[1] === u) {
            const up = this.userOnsets[0];
            if (up !== u && p !== a && (u > up) === (p > a)) {
                const ic0 = ic(up, a);
                if ((ic0 === 0 || ic0 === 7) && ic(u, p) === ic0) return false;
            }
        }
        return true;
    }

    /**
     * v2: the token BachDuet plays at the next tick during an answer, or -1 (let the decoder choose).
     * @param {ArrayLike<number>} logits - network logits
     * @param {Array<Array<number>>} tokens - [midi, artic] per token (parseTokens)
     * @param {Object} token2index
     * @param {boolean} strong - the next tick is beat 1 or 3
     * @param {number} level - the Imitation slider
     * @param {Array<number>|undefined} gaps - the model's GAP_QUANTILES entry
     * @return {number}
     */
    select(logits, tokens, token2index, strong, level, gaps) {
        if (!this.v2 || this.plan === null || this.active === null) return -1;
        const [m, artic, prev] = this.plan;
        const t = this.t;
        const rest = token2index['0_1'];
        if (m === 0) return rest;
        if (artic === 0) {
            const a = this.agent[this.agent.length - 1];
            return a > 0 ? (token2index[`${a}_0`] ?? rest) : rest;
        }
        const onset = [];
        for (let i = 0; i < tokens.length; i++) if (tokens[i][0] > 0 && tokens[i][1] === 1) onset.push(i);
        let lbest = -Infinity;
        for (const i of onset) if (logits[i] > lbest) lbest = logits[i];
        const logn = logThreshold(level, gaps);
        const S = this.localScale();
        const direction = prev === 0 ? 0 : sign(m - prev);
        const exact = ImitationMode.snap(diatonicShift(m, this.active.shift, this.active.key), S, direction);
        const u = this.user[this.user.length - 1][0];
        const heard = this.agent.filter((p) => p > 0);
        const register = heard.length ? heard.reduce((x, y) => x + y, 0) / heard.length : exact;
        const ceiling = u > 0 ? u : MIDI_MAX + 1;
        let choice = null;
        let used = null;
        const tok = exact >= MIDI_MIN && exact <= MIDI_MAX ? (token2index[`${exact}_1`] ?? -1) : -1;
        if (tok >= 0) {
            const gap = lbest - logits[tok];
            if ((this.style === 'exact' || this.style === 'hybrid') && gap <= logn && this.criticOk(exact, strong)) {
                choice = tok;
                used = 'exact';
            }
        }
        if (choice === null && (this.style === 'contour' || this.style === 'hybrid')) {
            let bestL = null;
            for (const i of onset) {
                const p = tokens[i][0];
                if (p >= ceiling || Math.abs(p - register) > WINDOW) continue;
                if (this.answerLast === 0 || prev === 0) {
                    if (Math.abs(p - exact) > 2) continue;
                } else {
                    const d = p - this.answerLast;
                    if (sign(d) !== direction || sizeClass(d) !== sizeClass(m - prev)) continue;
                }
                const l = logits[i];
                if (lbest - l > logn || !this.criticOk(p, strong)) continue;
                if (bestL === null || l > bestL) {
                    choice = i;
                    bestL = l;
                    used = 'contour';
                }
            }
        }
        if (choice === null) {
            this.vetoes += 1;
            this.counts.veto += 1;
            this.log.push([t, 'veto', this.vetoes]);
            if (this.vetoes >= 2) this.end(t, 'abort', 'vetoes');
            return -1;
        }
        this.counts[used] += 1;
        this.answerLast = tokens[choice][0];
        return choice;
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
