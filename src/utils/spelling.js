/**
 * Key-aware spelling of MIDI notes (C♯ vs D♭) for display.
 * Mirrors bachduet-v2/bdv2/keys/spelling.py (same rule, parity-tested).
 *
 * Rule:
 *  - Notes of the key's scale use the key's letters (minor keys: natural minor plus the raised 6th and 7th,
 *    e.g. F♯ and E♮ in G minor, F𝄪 in G♯ minor).
 *  - Other black keys: sharps in sharp keys, flats in flat keys. C major / A minor use C♯, E♭, F♯, G♯, B♭.
 *  - Other white keys stay natural.
 * Keys are given as labels like 'E♭ major', 'C# minor', 'Bb major' or as an index
 * (k < 12 major on pitch class k, k >= 12 minor on pitch class k - 12).
 */

const LETTERS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
const NATURAL_PC = [0, 2, 4, 5, 7, 9, 11];
// Tonic spelling per pitch class (as in the Starting key dropdown)
const MAJOR_TONIC = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
const MINOR_TONIC = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'G#', 'A', 'Bb', 'B'];
// Sharps (+) / flats (-) in the key signature, per tonic pitch class
const MAJOR_FIFTHS = [0, -5, 2, -3, 4, -1, 6, 1, -4, 3, -2, 5];
const MINOR_FIFTHS = [-3, 4, -1, -6, 1, -4, 3, -2, 5, 0, -5, 2];
const MAJOR_STEPS = [0, 2, 4, 5, 7, 9, 11];
const MINOR_STEPS = [0, 2, 3, 5, 7, 8, 10];
// Black keys outside the scale in keys without sharps or flats
const NEUTRAL = {1: ['C', 1], 3: ['E', -1], 6: ['F', 1], 8: ['G', 1], 10: ['B', -1]};

const ACCIDENTAL_TEXT = {'-2': 'bb', '-1': 'b', '0': '', '1': '#', '2': '##'};
const ACCIDENTAL_SYMBOL = {'-2': '𝄫', '-1': '♭', '0': '', '1': '♯', '2': '𝄪'};
const ACCIDENTAL_ALTER = {'#': 1, '♯': 1, 'b': -1, '♭': -1};

// Signed semitone difference wrapped to -6..5
const wrap = (d) => ((d % 12) + 18) % 12 - 6;

/**
 * @param {string|number|null} key - label or index
 * @return {number|null} key index
 */
export function keyIndex(key) {
    if (typeof key === 'number') return key;
    const m = /^\s*([A-G])\s*([#♯b♭]?)\s*(major|minor)/i.exec(key ?? '');
    if (!m) return null;
    const pc = (NATURAL_PC[LETTERS.indexOf(m[1].toUpperCase())] + (ACCIDENTAL_ALTER[m[2]] ?? 0) + 12) % 12;
    return m[3].toLowerCase() === 'major' ? pc : pc + 12;
}

const scaleCache = new Map();

// pitch class -> [letter index, alter] for the notes of the key's scale
function scaleSpellings(k) {
    if (scaleCache.has(k)) return scaleCache.get(k);
    const minor = k >= 12;
    const tonicPc = k % 12;
    const tonic = (minor ? MINOR_TONIC : MAJOR_TONIC)[tonicPc];
    const tonicLetter = LETTERS.indexOf(tonic[0]);
    const steps = minor ? MINOR_STEPS : MAJOR_STEPS;
    const map = new Map();
    const add = (degree, step) => {
        const letter = (tonicLetter + degree) % 7;
        const pc = (tonicPc + step) % 12;
        map.set(pc, [letter, wrap(pc - NATURAL_PC[letter])]);
    };
    steps.forEach((step, degree) => add(degree, step));
    if (minor) {
        add(5, 9); // raised 6th
        add(6, 11); // raised 7th
    }
    scaleCache.set(k, map);
    return map;
}

/**
 * Spell a MIDI note in a key.
 * @param {number} midi
 * @param {string|number|null} key - label or index; null spells with sharps (Euterpe's old behaviour)
 * @return {{letter: string, alter: number, octave: number}}
 */
export function spellMidi(midi, key) {
    const pc = ((midi % 12) + 12) % 12;
    const k = keyIndex(key);
    let letterIndex;
    let alter;
    const inScale = k == null ? null : scaleSpellings(k).get(pc);
    if (inScale) {
        [letterIndex, alter] = inScale;
    } else if (NATURAL_PC.includes(pc)) {
        [letterIndex, alter] = [NATURAL_PC.indexOf(pc), 0];
    } else {
        const fifths = k == null ? 1 : (k >= 12 ? MINOR_FIFTHS : MAJOR_FIFTHS)[k % 12];
        if (fifths > 0) [letterIndex, alter] = [NATURAL_PC.indexOf(pc - 1), 1];
        else if (fifths < 0) [letterIndex, alter] = [NATURAL_PC.indexOf((pc + 1) % 12), -1];
        else [letterIndex, alter] = [LETTERS.indexOf(NEUTRAL[pc][0]), NEUTRAL[pc][1]];
    }
    // The octave follows the letter (B♯3 sounds as C4, C♭4 as B3)
    const octave = Math.floor((midi - alter) / 12) - 1;
    return {letter: LETTERS[letterIndex], alter, octave};
}

/**
 * @return {string} e.g. 'Eb4', 'F##3' (ASCII accidentals)
 */
export function spellName(midi, key) {
    const s = spellMidi(midi, key);
    return `${s.letter}${ACCIDENTAL_TEXT[s.alter]}${s.octave}`;
}

/**
 * @return {string} e.g. 'E♭4'
 */
export function spellLabel(midi, key, withOctave = true) {
    const s = spellMidi(midi, key);
    return `${s.letter}${ACCIDENTAL_SYMBOL[s.alter]}${withOctave ? s.octave : ''}`;
}

/**
 * VexFlow key and accidental, e.g. {key: 'eb/4', accidental: 'b'} (accidental '' for naturals).
 */
export function spellVexFlow(midi, key) {
    const s = spellMidi(midi, key);
    return {key: `${s.letter.toLowerCase()}${ACCIDENTAL_TEXT[s.alter]}/${s.octave}`, accidental: ACCIDENTAL_TEXT[s.alter]};
}
