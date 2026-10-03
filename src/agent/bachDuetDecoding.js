/**
 * Decoding for BachDuet: turns the network's logits into the next agent token.
 * Plain JS (no TF.js), so the exact same code runs in the agent worker and in offline simulations.
 *
 * On top of plain temperature sampling it can
 *  - anticipate the user: a second, role-swapped copy of the network predicts the user's next note,
 *    and candidates that are likely to be consonant with it are favoured (antLam),
 *  - keep the agent on the other side of the user (crossLam). The side follows the user's current
 *    register (see updateSide), so it never locks the agent into the starting voice,
 *  - steer away from rests (restBias).
 * With antLam = 0 and restBias = 0 it is plain sampling from softmax(logits / T), like before.
 */

// Interval classes treated as consonant: unison/octave, minor/major 3rd, perfect 5th, minor/major 6th
const CONSONANT = new Set([0, 3, 4, 7, 8, 9]);
// Interval class of the upper note above the lower note
const intervalClass = (a, b) => (Math.max(a, b) - Math.min(a, b)) % 12;

// Register split for the side rule: the user above SPLIT + DEAD_BAND puts the agent below,
// below SPLIT - DEAD_BAND puts it above; in between, the previous side is kept.
export const REGISTER_SPLIT = 60; // middle C
export const DEAD_BAND = 3;

/**
 * @param {Object} index2token - tokenIndexDict.midiArtic.index2token ('60_1' style tokens)
 * @return {Array<Array<number>>} [midi, artic] per token index
 */
export function parseTokens(index2token) {
    return Array.from({length: Object.keys(index2token).length},
        (_, i) => index2token[i].split('_').map(Number));
}

/**
 * Which side of the user the agent should be on: -1 below, +1 above.
 * @param {number} side - the current side
 * @param {number|null} userPitch - the user's sounding pitch (null if silent)
 * @return {number}
 */
export function updateSide(side, userPitch) {
    if (userPitch == null) return side;
    if (userPitch >= REGISTER_SPLIT + DEAD_BAND) return -1;
    if (userPitch <= REGISTER_SPLIT - DEAD_BAND) return 1;
    return side;
}

function softmax(values, temperature = 1) {
    let max = -Infinity;
    for (const v of values) if (v > max) max = v;
    const e = values.map((v) => (v === -Infinity ? 0 : Math.exp((v - max) / temperature)));
    const z = e.reduce((a, b) => a + b, 0) || 1;
    return e.map((x) => x / z);
}

// Pitch sounding at the next step if token i is chosen; null for rests
function nextPitch(tokens, i, current) {
    const [midi, artic] = tokens[i];
    if (midi === 0) return null;
    return (artic === 0 && midi === current) ? current : midi;
}

/**
 * Choose the next agent token.
 * @param {Object} p
 * @param {Array<Array<number>>} p.tokens - from parseTokens()
 * @param {ArrayLike<number>} p.logits - agent stream logits
 * @param {ArrayLike<number>|null} p.swapLogits - role-swapped stream logits (predicts the user)
 * @param {number|null} p.agentPitch - the agent's sounding pitch (null if silent)
 * @param {number|null} p.userPitch - the user's sounding pitch (null if silent)
 * @param {number} p.temperature - sampling temperature (> 0)
 * @param {number} [p.antLam=0] - anticipation weight
 * @param {number} [p.crossLam=0] - penalty for being on the wrong side of the user
 * @param {number} [p.side=0] - -1 agent below the user, +1 above, 0 no preference
 * @param {number} [p.restBias=0] - subtracted from rest logits
 * @param {function} [p.random=Math.random]
 * @return {number} token index
 */
export function chooseToken({tokens, logits, swapLogits, agentPitch, userPitch, temperature,
    antLam = 0, crossLam = 0, side = 0, restBias = 0, random = Math.random}) {
    const n = tokens.length;
    const adjusted = Array.from(logits);
    const isRest = tokens.map(([midi]) => midi === 0);

    // Distribution over the user's next pitch (rests are neutral, so they are left out)
    let userDist = null;
    if (antLam > 0 && swapLogits) {
        userDist = new Map();
        let z = 0;
        softmax(Array.from(swapLogits)).forEach((p, i) => {
            const q = nextPitch(tokens, i, userPitch);
            if (q == null) return;
            userDist.set(q, (userDist.get(q) ?? 0) + p);
            z += p;
        });
        if (z > 0) for (const [q, p] of userDist) userDist.set(q, p / z);
        else userDist = null;
    }

    if (userDist || (crossLam > 0 && side !== 0 && userPitch != null)) {
        const harmony = new Array(n).fill(0);
        for (let i = 0; i < n; i++) {
            if (isRest[i]) continue;
            const p = nextPitch(tokens, i, agentPitch);
            let h = 0;
            if (crossLam > 0 && side !== 0 && userPitch != null && (p - userPitch) * side <= 0) h -= crossLam;
            if (userDist) {
                let consonant = 0;
                for (const [q, prob] of userDist) if (CONSONANT.has(intervalClass(q, p))) consonant += prob;
                h += antLam * Math.log(consonant + 0.05);
            }
            harmony[i] = h;
        }
        // Rests get the probability-weighted mean adjustment, so these terms don't push towards or away from resting
        const p0 = softmax(Array.from(logits));
        let num = 0;
        let den = 0;
        for (let i = 0; i < n; i++) {
            if (!isRest[i]) {
                num += p0[i] * harmony[i];
                den += p0[i];
            }
        }
        const restAdjustment = den > 0 ? num / den : 0;
        for (let i = 0; i < n; i++) adjusted[i] += isRest[i] ? restAdjustment : harmony[i];
    }

    if (restBias > 0) for (let i = 0; i < n; i++) if (isRest[i]) adjusted[i] -= restBias;

    const probs = softmax(adjusted, temperature);
    let r = random();
    for (let i = 0; i < n; i++) {
        r -= probs[i];
        if (r <= 0) return i;
    }
    return n - 1;
}
