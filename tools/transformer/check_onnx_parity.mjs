// Check onnxruntime-web (WASM, as in the agent worker) against PyTorch for the BachDuet transformer: streams the
// fixture's 420 chorale steps (BachDuet + role-swapped stream, B=2) through public/checkpoints_tsmall/model.onnx
// from an empty KV cache and compares the logits with bdv2's step_cached at the fixture steps; also times a step.
//   node tools/transformer/check_onnx_parity.mjs
// The fixture comes from bdv2/export_onnx.py in xribene/bachduet-v2 (exports/<run>/parity.json).
import fs from 'node:fs';

const ort = await import('onnxruntime-web');
ort.env.wasm.numThreads = 1;
const dir = 'public/checkpoints_tsmall';
const s = await ort.InferenceSession.create(fs.readFileSync(`${dir}/model.onnx`), {executionProviders: ['wasm']});
const meta = JSON.parse(fs.readFileSync(`${dir}/primers.json`));
const {steps, fixtures} = JSON.parse(fs.readFileSync('tools/transformer/parity_t_small_chorales.json'));
const B = 2, P = meta.cacheSteps, n = meta.layers * B * meta.heads * P * meta.headDim;
const dims = [meta.layers, B, meta.heads, P, meta.headDim];
let pk = new ort.Tensor('float32', new Float32Array(n), dims), pv = new ort.Tensor('float32', new Float32Array(n), dims);
let plen = 0;
const want = Object.fromEntries(fixtures.map((f) => [f.t, f.logits]));
let max = 0, agree = 0, checked = 0; const ts = [];
const i64 = (a) => new ort.Tensor('int64', BigInt64Array.from(a.map(BigInt)), [a.length]);
for (let t = 0; t < steps.length; t++) {
  const [a, u, apc, upc, r] = steps[t];
  const feeds = {agent_tok: i64([a, u]), user_tok: i64([u, a]), agent_pc: i64([apc, upc]), user_pc: i64([upc, apc]),
    rhythm: i64([r, r]), past_k: pk, past_v: pv, past_len: i64([plen, plen])};
  const t0 = performance.now();
  const o = await s.run(feeds);
  ts.push(performance.now() - t0);
  pk = o.new_k; pv = o.new_v; plen = Math.min(plen + 1, P);
  if (want[t]) {
    const V = o.logits.dims[1];
    want[t].forEach((row, b) => {
      const js = Array.from(o.logits.data.slice(b * V, (b + 1) * V));
      row.forEach((x, i) => { max = Math.max(max, Math.abs(x - js[i])); });
      if (js.indexOf(Math.max(...js)) === row.indexOf(Math.max(...row))) agree++;
      checked++;
    });
  }
}
ts.sort((x, y) => x - y);
console.log(`checked ${checked} rows at t=${Object.keys(want)}: max|d|=${max.toExponential(2)}, top-1 identical ${agree}/${checked}`);
console.log(`step B=2: median ${ts[ts.length >> 1].toFixed(2)} ms, p95 ${ts[Math.floor(ts.length * .95)].toFixed(2)}, max ${ts[ts.length - 1].toFixed(2)}`);
if (max > 1e-3 || agree !== checked) process.exit(1);
