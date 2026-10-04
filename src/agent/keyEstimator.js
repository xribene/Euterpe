/**
 * Key estimate for BachDuet from what both voices are playing (display only).
 * Plain JS, no TF.js. Port of dual_estimate() in bachduet-v2/bdv2/keys/improve.py (see bachduet-v2/KEYS.md):
 * two exponentially decaying pitch-class histograms of both voices (long memory: 16 beats, short: 4 beats),
 * correlated with the 24 Temperley-Kostka-Payne key profiles every 2 beats. The long one gives a stable
 * estimate; when the short one names a new key, the estimate switches to it, so modulations are followed
 * quickly. Settings tuned for note SPELLING (C♯ vs D♭) and re-locking after modulations, not exact key.
 */

// Temperley-Kostka-Payne profiles (music21), tonic first
const MAJOR = [0.748, 0.060, 0.488, 0.082, 0.670, 0.460, 0.096, 0.715, 0.104, 0.366, 0.057, 0.400];
const MINOR = [0.712, 0.084, 0.474, 0.618, 0.049, 0.460, 0.105, 0.747, 0.404, 0.067, 0.133, 0.330];

const LONG_DECAY = Math.exp(-1 / (16 * 4)); // 16 beats of 4 sixteenths
const SHORT_DECAY = Math.exp(-1 / (4 * 4)); // 4 beats
const UPDATE_EVERY = 8; // sixteenths (2 beats)
const PERSIST = 1; // short-window updates in a row before switching
const SHORT_MARGIN = 0.0;
const LONG_MARGIN = 0.1;

// Key index k: k < 12 major on pitch class k, k >= 12 minor on pitch class k - 12.
// Display names follow the Starting key dropdown spelling.
const MAJOR_NAMES = ['C', 'D♭', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];
const MINOR_NAMES = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'B♭', 'B'];
const LETTERS = {C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11};

function centred(v) {
    const mean = v.reduce((a, b) => a + b, 0) / v.length;
    return v.map((x) => x - mean);
}

// Centred, rotated profiles: TEMPLATES[k][pc]
const TEMPLATES = Array.from({length: 24}, (_, k) => {
    const profile = k < 12 ? MAJOR : MINOR;
    const tonic = k % 12;
    return centred(Array.from({length: 12}, (_, pc) => profile[(pc - tonic + 12) % 12]));
});
const TEMPLATE_NORMS = TEMPLATES.map((t) => Math.hypot(...t));

/**
 * @param {number} k - key index
 * @return {string} e.g. 'E♭ major'
 */
export function keyLabel(k) {
    return k < 12 ? `${MAJOR_NAMES[k]} major` : `${MINOR_NAMES[k - 12]} minor`;
}

/**
 * @param {string} label - e.g. 'E♭ major', 'Db major', 'C# minor'
 * @return {number|null} key index
 */
export function keyIndexFromLabel(label) {
    const m = /^\s*([A-G])\s*([#♯b♭]?)\s*(major|minor)/i.exec(label ?? '');
    if (!m) return null;
    const accidental = {'#': 1, '♯': 1, 'b': -1, '♭': -1}[m[2]] ?? 0;
    const pc = (LETTERS[m[1].toUpperCase()] + accidental + 12) % 12;
    return m[3].toLowerCase() === 'major' ? pc : pc + 12;
}

// Pearson correlation of a histogram with the 24 key profiles; null if the histogram is flat/empty
function correlations(hist) {
    const h = centred(hist);
    const norm = Math.hypot(...h);
    if (norm === 0) return null;
    return TEMPLATES.map((t, k) => t.reduce((a, x, i) => a + x * h[i], 0) / (norm * TEMPLATE_NORMS[k]));
}

const argmax = (v) => v.reduce((best, x, i) => (x > v[best] ? i : best), 0);

export class KeyEstimator {
    /**
     * @param {string|null} startKeyLabel - the key to start from (null: decide from the first notes)
     */
    constructor(startKeyLabel = null) {
        this.reset(startKeyLabel);
    }

    reset(startKeyLabel = null) {
        this.longHist = new Array(12).fill(0);
        this.shortHist = new Array(12).fill(0);
        this.current = keyIndexFromLabel(startKeyLabel);
        this.streakKey = null;
        this.streak = 0;
    }

    /**
     * Call once per 16th with the pitches sounding at that tick (MIDI, or 0/null when silent).
     * @param {number|null} userPitch
     * @param {number|null} agentPitch
     * @param {number} tick - position in the bar, 0-15
     */
    update(userPitch, agentPitch, tick) {
        for (let pc = 0; pc < 12; pc++) {
            this.longHist[pc] *= LONG_DECAY;
            this.shortHist[pc] *= SHORT_DECAY;
        }
        for (const pitch of [userPitch, agentPitch]) {
            if (pitch) {
                this.longHist[pitch % 12] += 1;
                this.shortHist[pitch % 12] += 1;
            }
        }
        if ((tick + 1) % UPDATE_EVERY === 0) this.estimate();
    }

    estimate() {
        const rLong = correlations(this.longHist);
        if (!rLong) return;
        const rShort = correlations(this.shortHist);
        const bestLong = argmax(rLong);
        const bestShort = rShort ? argmax(rShort) : null;
        this.streak = bestShort === this.streakKey ? this.streak + 1 : 1;
        this.streakKey = bestShort;
        const cur = this.current;
        if (cur == null) {
            this.current = bestLong;
        } else if (bestShort != null && bestShort !== cur && this.streak >= PERSIST &&
                rShort[bestShort] - rShort[cur] > SHORT_MARGIN) {
            this.current = bestShort; // the short window has agreed on a new key
        } else if (bestLong !== cur && rLong[bestLong] - rLong[cur] > LONG_MARGIN) {
            this.current = bestLong; // slow drift
        }
    }

    /**
     * @return {string|null} the current key, e.g. 'E♭ major'
     */
    getKey() {
        return this.current == null ? null : keyLabel(this.current);
    }
}
