// Browser check of tests/audio-io-app: 16 kHz microphone frames (sizes, positions, timestamps, level, the
// microphone's speech processing off) and a 440 Hz sine rendered at 16 kHz in blocks of 2048, measured at the
// page's output. Uses Chrome's fake microphone (a beep) and the normal autoplay policy with a real click.
//   (cd tests/audio-io-app && pnpm exec vite --port 5410) &; node tools/smoke/audio-io.mjs http://localhost:5410/
import {chromium} from 'playwright';

const b = await chromium.launch({channel: 'chrome', headless: true,
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream']});
const p = await (await b.newContext({permissions: ['midi', 'midi-sysex', 'microphone']})).newPage();
const errors = [];
p.on('console', (m) => {
    if (m.type() === 'error' || m.text().includes('[euterpe]')) errors.push(m.text().slice(0, 160));
});
await p.goto(process.argv[2]);
await p.waitForFunction(() => window.__euterpe?.ready, null, {timeout: 60000});
await p.locator('[data-testid=euterpe-start]').click();
await p.waitForTimeout(5000);
const result = await p.evaluate(async () => {
    const find = (vm) => (vm.$options.methods?.processUserNoteEvent ? vm : vm.$children.map(find).find(Boolean));
    const vm = find(document.getElementById('app').__vue__);
    const track = vm.mediaStreamSource.mediaStream.getAudioTracks()[0].getSettings();
    const an = vm.audioContext.createAnalyser();
    an.fftSize = 16384;
    vm.$store.state.samplers.samplersAndBuses.agent.bus.connect(an);
    await new Promise((r) => setTimeout(r, 600));
    const f = new Float32Array(an.frequencyBinCount);
    an.getFloatFrequencyData(f);
    let k = 1;
    for (let i = 1; i < f.length; i++) if (f[i] > f[k]) k = i;
    const labels = window.__euterpe.agentMessages().map((m) => m.message?.[14]).filter(Boolean);
    return {
        mic: {echoCancellation: track.echoCancellation, noiseSuppression: track.noiseSuppression,
            autoGainControl: track.autoGainControl, channelCount: track.channelCount},
        pageSampleRate: vm.audioContext.sampleRate,
        agent: labels.length ? JSON.parse(labels[labels.length - 1]) : null,
        output: {peakHz: +(k * vm.audioContext.sampleRate / an.fftSize).toFixed(1), ...window.__euterpe.audioOut},
    };
});
console.log(JSON.stringify(result, null, 1));
console.log('errors / [euterpe] messages:', errors);
await b.close();
