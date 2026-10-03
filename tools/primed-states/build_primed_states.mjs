// Build public/primedStates.bin + public/primedStates.json: BachDuet LSTM states "primed" with the
// first bars of a Bach chorale in each of the 24 keys, for each starting voice of the user.
//   upper: the user plays the soprano, BachDuet the bass
//   lower: the user plays the bass, BachDuet the soprano
// For every (key, voice) we store BachDuet's state as [h1, c1, h2, c2] x 600 float32. The role-swapped
// stream (used for anticipating the user) for one voice is the agent stream of the other voice.
//
// Usage (from the repo root):
//   python3 -m venv .venv && .venv/bin/pip install music21
//   .venv/bin/python tools/primed-states/extract_chorales.py /tmp/chorales.json
//   node tools/primed-states/build_primed_states.mjs /tmp/chorales.json
import fs from 'node:fs';
import * as tf from '@tensorflow/tfjs';
import '@tensorflow/tfjs-backend-wasm';

const CHORALES = process.argv[2];
const PRIME_BARS = 4;
// Primer per key: [chorale id in the music21 corpus, transposition in semitones]
const PRIMERS = {
    'C major': ['bwv328', 0], 'C minor': ['bwv244.17', 0], 'C# major': ['bwv328', 1], 'C# minor': ['bwv437', -1],
    'D major': ['bwv190.7', 0], 'D minor': ['bwv437', 0], 'D# major': ['bwv245.40', 0], 'D# minor': ['bwv437', 1],
    'E major': ['bwv60.5', 0], 'E minor': ['bwv227.1', 0], 'F major': ['bwv325', 0], 'F minor': ['bwv40.8', 0],
    'F# major': ['bwv371', -1], 'F# minor': ['bwv42.7', 0], 'G major': ['bwv371', 0], 'G minor': ['bwv10.7', 0],
    'G# major': ['bwv244.10', 0], 'G# minor': ['bwv126.6', -1], 'A major': ['bwv37.6', 0], 'A minor': ['bwv126.6', 0],
    'A# major': ['bwv362', 0], 'A# minor': ['bwv354', 0], 'B major': ['bwv328', -1], 'B minor': ['bwv261', 0],
};
const VOICES = {upper: {user: 'S', agent: 'B'}, lower: {user: 'B', agent: 'S'}};

await tf.setBackend('wasm');
await tf.ready();
const dict = JSON.parse(fs.readFileSync('public/globalTokenIndexDict.json', 'utf8'));
const chorales = Object.fromEntries(JSON.parse(fs.readFileSync(CHORALES, 'utf8')).map((c) => [c.id, c]));

async function loadModel(path) {
    const mj = JSON.parse(fs.readFileSync(path, 'utf8'));
    const dir = path.slice(0, path.lastIndexOf('/') + 1);
    const weightSpecs = mj.weightsManifest.flatMap((g) => g.weights);
    const data = Buffer.concat(mj.weightsManifest.flatMap((g) => g.paths.map((p) => fs.readFileSync(dir + p))));
    return tf.loadLayersModel(tf.io.fromMemory({modelTopology: mj.modelTopology, weightSpecs,
        weightData: data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength)}));
}
const modelEmb = await loadModel('public/checkpoints/modelsFinal_Emb/model_cleaned.json');
const modelLstm = await loadModel('public/checkpoints/modelsFinal_Lstm/model.json');

// Same token conversion and tick encoding as the agent (bachDuetUtils.js)
const BAR = [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, -1];
const BEAT = [0, -2, -1, -2, 0, -2, -1, -2, 0, -2, -1, -2, 0, -2, -1, -2];
const ACCENT = [0, -3, -2, -3, -2, -4, -3, -4, -1, -3, -2, -3, -2, -4, -3, -4];
const tickIndex = (t) => dict.rhythm.token2index[`${BAR[t % 16]}_${BEAT[t % 16]}_${ACCENT[t % 16]}`];
const clamp = (m) => Math.min(94, Math.max(28, m));
function token(toks, i) {
    let midi;
    let artic;
    if (toks[i] === 'r') [midi, artic] = [0, 1];
    else if (typeof toks[i] === 'number') [midi, artic] = [clamp(toks[i]), 1];
    else {
        let j = i;
        while (typeof toks[j] !== 'number') j--;
        [midi, artic] = [clamp(toks[j]), 0];
    }
    return {ind: dict.midiArtic.token2index[`${midi}_${artic}`], cpc: midi === 0 ? 12 : midi % 12};
}

// Run the network over the primer, teacher-forced with both real voices, starting from zeros.
function prime(agentToks, userToks) {
    let states = [0, 1, 2, 3].map(() => tf.zeros([1, 600]));
    for (let t = 0; t < agentToks.length; t++) {
        const a = token(agentToks, t);
        const u = token(userToks, t);
        const next = tf.tidy(() => {
            const [eM, eC, eR] = modelEmb.predict([tf.tensor2d([[a.ind, u.ind]]), tf.tensor2d([[a.cpc, u.cpc]]),
                tf.tensor2d([[tickIndex(t)]])]);
            const emM = tf.concat([eM.slice([0, 0, 0], [1, 1, 150]), eM.slice([0, 1, 0], [1, 1, 150])], 2);
            const emC = tf.concat([eC.slice([0, 0, 0], [1, 1, 150]), eC.slice([0, 1, 0], [1, 1, 150])], 2);
            return modelLstm.predict([tf.concat([emM, emC, eR], 2), ...states]).slice(1);
        });
        tf.dispose(states);
        states = next;
    }
    const arrays = states.map((s) => s.dataSync().slice());
    tf.dispose(states);
    return arrays;
}

const entries = [];
const blocks = [];
for (const [key, [id, transpose]] of Object.entries(PRIMERS)) {
    const c = chorales[id];
    // start on a full bar: skip a padded pickup bar
    const start = ['S', 'B'].some((v) => c.voices[v].slice(0, 16).every((t) => t === 'r')) ? 16 : 0;
    const part = (v) => c.voices[v].slice(start, start + PRIME_BARS * 16).map((t) => (typeof t === 'number' ? t + transpose : t));
    for (const [voice, {user, agent}] of Object.entries(VOICES)) {
        blocks.push(...prime(part(agent), part(user)));
        entries.push({key, voice, source: id, transpose});
    }
    console.log(`${key.padEnd(9)} <- ${id} transposed ${transpose >= 0 ? '+' : ''}${transpose}`);
}
const flat = new Float32Array(blocks.length * 600);
blocks.forEach((b, i) => flat.set(b, i * 600));
fs.writeFileSync('public/primedStates.bin', Buffer.from(flat.buffer));
fs.writeFileSync('public/primedStates.json', JSON.stringify({
    description: 'BachDuet LSTM states primed with the first bars of a Bach chorale per key and starting voice. ' +
        'Per entry, 4 vectors of 600 float32 in primedStates.bin: [h1, c1, h2, c2]. voice = the voice the USER starts on.',
    primeBars: PRIME_BARS, stateSize: 600, entries}, null, 1));
console.log(`wrote public/primedStates.bin (${(flat.byteLength / 1024).toFixed(0)} KB) and public/primedStates.json`);
