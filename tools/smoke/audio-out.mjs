// Measures the agent audio output of tests/audio-out (a 440 Hz sine): silent before the start button, peak
// frequency and level after, frames played and underruns, silent when the agent bus is muted.
//   (cd tests/audio-out && pnpm dev --port 5390) &; node tools/smoke/audio-out.mjs http://localhost:5390/[?mode=push|slow]
import {chromium} from 'playwright';
const b = await chromium.launch({channel: 'chrome', headless: true, args: ['--autoplay-policy=no-user-gesture-required']});
const p = await (await b.newContext({permissions: ['midi', 'midi-sysex', 'microphone']})).newPage();
const errors = [], warns = []; p.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 200)); if (m.text().includes('[euterpe]')) warns.push(m.text().slice(0, 200)); });
p.on('pageerror', (e) => errors.push('pageerror ' + e.message));
await p.goto(process.argv[2]); await p.waitForFunction(() => window.__euterpe?.ready, null, {timeout: 60000});
const measure = () => p.evaluate(async () => {
  const find = (vm) => (vm.$options.methods?.processUserNoteEvent ? vm : vm.$children.map(find).find(Boolean));
  const vm = find(document.getElementById('app').__vue__);
  const tone = vm.$store.state.samplers.samplersAndBuses.agent.bus.context;
  if (!window.__an) { window.__an = vm.audioContext.createAnalyser(); window.__an.fftSize = 8192; tone.destination.connect(window.__an); }
  const an = window.__an; await new Promise((r) => setTimeout(r, 300));
  const t = new Float32Array(an.fftSize); an.getFloatTimeDomainData(t);
  const f = new Float32Array(an.frequencyBinCount); an.getFloatFrequencyData(f);
  let k = 0; for (let i = 1; i < f.length; i++) if (f[i] > f[k]) k = i;
  return {rms: +Math.sqrt(t.reduce((a, x) => a + x * x, 0) / t.length).toFixed(4), peakHz: Math.round(k * vm.audioContext.sampleRate / an.fftSize), stats: window.__euterpe.audioOut};
});
await p.waitForTimeout(1500);
console.log('before start:', JSON.stringify(await measure()));
await p.evaluate(() => { window.__euterpe.enter(); window.__euterpe.startClock(); }); await p.waitForTimeout(500);
console.log('after 0.5 s:', JSON.stringify(await measure()));
await p.waitForTimeout(5000);
console.log('after 5.5 s:', JSON.stringify(await measure()));
await p.evaluate(() => { const find = (vm) => (vm.$options.methods?.processUserNoteEvent ? vm : vm.$children.map(find).find(Boolean)); find(document.getElementById('app').__vue__).$store.state.samplers.samplersAndBuses.agent.bus.mute = true; });
console.log('agent bus muted:', JSON.stringify(await measure()));
console.log('errors', errors, 'euterpe messages', warns); await b.close();
