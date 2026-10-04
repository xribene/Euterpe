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
 * On 16th off-beats the network alone decides whether to hold, start a note or rest, and anticipation
 * only picks the pitch: letting it re-attack there to dodge predicted clashes produced 16th-note
 * rhythms that don't exist in chorales.
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

// Sample an index with probability proportional to weights
function sample(weights, random) {
    const total = weights.reduce((a, b) => a + b, 0);
    let r = random() * total;
    for (let i = 0; i < weights.length; i++) {
        r -= weights[i];
        if (r <= 0 && weights[i] > 0) return i;
    }
    return weights.findLastIndex((w) => w > 0);
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
 * @param {boolean} [p.weakStep=false] - the next step is a 16th off-beat
 * @param {number} [p.parLam=0] - penalty for parallel 5ths/8ves with the user's predicted motion
 * @param {number} [p.hiddenLam=0] - penalty for hidden 5ths/8ves (similar motion into a perfect interval)
 * @param {number} [p.strongMult=1] - anticipation weight multiplier on beats 1 and 3
 * @param {boolean} [p.strongStep=false] - the next step is beat 1 or 3
 * @param {number} [p.bonusToken=-1] - imitation mode (imitation.js): token whose logit gets `bonus`
 * @param {number} [p.bonus=0]
 * @param {function} [p.random=Math.random]
 * @return {number} token index
 */
export function chooseToken(p) {
    if (p.bonusToken != null && p.bonusToken >= 0 && p.bonus) {
        const boosted = Array.from(p.logits);
        boosted[p.bonusToken] += p.bonus;
        p = {...p, logits: boosted};
    }
    const {tokens, logits, agentPitch, temperature, antLam = 0, restBias = 0, weakStep = false,
        random = Math.random} = p;
    if (!(weakStep && antLam > 0)) return chooseAdjusted(p);

    // 16th off-beat: hold / new note / rest from the network (and the rest bias) only
    const kind = tokens.map(([midi, artic]) =>
        midi === 0 ? 'rest' : (artic === 0 && midi === agentPitch) ? 'hold' : 'note');
    const probs = softmax(Array.from(logits, (l, i) => (kind[i] === 'rest' ? l - restBias : l)), temperature);
    const events = ['note', 'hold', 'rest'];
    const event = events[sample(events.map((e) => probs.reduce((a, x, i) => a + (kind[i] === e ? x : 0), 0)), random)];
    if (event !== 'note') return sample(probs.map((x, i) => (kind[i] === event ? x : 0)), random);
    // a new note: anticipation and the side rule pick which one
    return chooseAdjusted({...p, logits: Array.from(logits, (l, i) => (kind[i] === 'note' ? l : -Infinity)),
        restBias: 0});
}

// Interval classes of perfect consonances (unison/octave, 5th), for the parallel / hidden checks
const isPerfect = (ic) => ic === 0 || ic === 7;

// Expected number of parallel and hidden 5ths/8ves if the agent moves from agentPitch to p while the
// user moves from userPitch to a pitch drawn from userDist (similar motion into a perfect interval;
// parallel if the interval class stays the same, hidden otherwise)
function motionPenalties(userDist, agentPitch, userPitch, p) {
    let par = 0;
    let hidden = 0;
    if (agentPitch == null || userPitch == null || p === agentPitch) return [par, hidden];
    const ic0 = intervalClass(userPitch, agentPitch);
    const agentDir = Math.sign(p - agentPitch);
    for (const [q, prob] of userDist) {
        if (q === userPitch || Math.sign(q - userPitch) !== agentDir) continue;
        const ic1 = intervalClass(q, p);
        if (!isPerfect(ic1)) continue;
        if (isPerfect(ic0) && ic1 === ic0) par += prob;
        else hidden += prob;
    }
    return [par, hidden];
}

function chooseAdjusted({tokens, logits, swapLogits, agentPitch, userPitch, temperature,
    antLam = 0, crossLam = 0, side = 0, restBias = 0, parLam = 0, hiddenLam = 0, strongMult = 1,
    strongStep = false, random = Math.random}) {
    const n = tokens.length;
    const adjusted = Array.from(logits);
    const isRest = tokens.map(([midi]) => midi === 0);
    const motionTerms = parLam > 0 || hiddenLam > 0;
    // anticipation counts more when the next step is beat 1 or 3
    const ant = strongStep ? antLam * strongMult : antLam;

    // Distribution over the user's next pitch (rests are neutral, so they are left out)
    let userDist = null;
    if ((antLam > 0 || motionTerms) && swapLogits) {
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
            if (userDist && antLam > 0) {
                let consonant = 0;
                for (const [q, prob] of userDist) if (CONSONANT.has(intervalClass(q, p))) consonant += prob;
                h += ant * Math.log(consonant + 0.05);
            }
            if (userDist && motionTerms) {
                const [par, hidden] = motionPenalties(userDist, agentPitch, userPitch, p);
                h -= parLam * par + hiddenLam * hidden;
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

    return sample(softmax(adjusted, temperature), random);
}
