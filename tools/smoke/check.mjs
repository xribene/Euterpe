// Smoke check of a running Euterpe page (dev server or a build behind vite preview), with system Chrome:
// cross-origin isolated, the agent reports ready, the UI starts, the clock ticks, a phrase played on the laptop
// keyboard gets an answer from the agent, samples load, no console errors.
//   node tools/smoke/check.mjs <url> [--expect-answer] [--set=slider:3:0 ...] [--wait=ms] [--logs] [--screenshot=f.png]
// --set changes a widget (kind:id:value, as ctx.params) before the phrase.
// Prints a JSON report; exits 1 if a check fails.
import {chromium} from 'playwright';

const url = process.argv[2] ?? 'http://localhost:5173/';
const arg = (name, fallback) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1] ?? fallback;
const answerWait = Number(arg('wait', 4000));

const browser = await chromium.launch({channel: 'chrome', headless: true,
    args: ['--autoplay-policy=no-user-gesture-required', '--use-fake-ui-for-media-stream',
        '--use-fake-device-for-media-stream']});
const context = await browser.newContext({permissions: ['microphone', 'midi', 'midi-sysex']});
const page = await context.newPage();
const errors = [];
const logs = [];
const failed = [];
let samples = 0;
const onConsole = (source) => (m) => {
    logs.push(`[${source}] ${m.type()}: ${m.text()}`);
    if (m.type() === 'error') errors.push(`[${source}] ${m.text()} ${m.location()?.url ?? ''}`);
};
page.on('console', onConsole('page'));
page.on('pageerror', (e) => errors.push('[pageerror] ' + e.message));
page.on('worker', (w) => w.on('console', onConsole('worker')));
context.on('response', (r) => {
    if (r.status() >= 400) failed.push(`${r.status()} ${r.url()}`);
    else if (r.url().includes('/samples/')) samples++;
});
const report = {url};
const t0 = Date.now();
await page.goto(url);
report.crossOriginIsolated = await page.evaluate(() => self.crossOriginIsolated);
// window.__euterpe: the UI's handle for tests (packages/euterpe/src/utils/handle.js)
await page.waitForFunction(() => window.__euterpe, null, {timeout: 60000});
await page.evaluate(() => window.__euterpe.whenReady());
report.readyAfterMs = Date.now() - t0;
await page.evaluate(() => window.__euterpe.enter());
await page.waitForTimeout(500);
report.started = await page.evaluate(() => window.__euterpe.entered);
await page.keyboard.press('Escape'); // the intro dialog
await page.evaluate(() => window.__euterpe.startClock());
const tickAt = () => page.evaluate(() => window.__euterpe.tick.global);
await page.waitForTimeout(500);
const ticks = await tickAt();
await page.waitForTimeout(1000);
report.ticksPerSecond = (await tickAt()) - ticks;

for (const [kind, id, value] of process.argv.filter((a) => a.startsWith('--set=')).map((a) => a.slice(6).split(':'))) {
    await page.evaluate(([k, i, v]) => window.__euterpe.setParam(k, Number(i), Number(v)), [kind, id, value]);
}
if (process.argv.some((a) => a.startsWith('--set='))) {
    await page.waitForTimeout(300); // the agent reads widget changes every 100 ms
    report.params = await page.evaluate(() => window.__euterpe.params);
}

// a phrase on the laptop keyboard (q w e r t = C5 D5 E5 F5 G5), 8th notes at 100 BPM
const before = await page.evaluate(() => window.__euterpe.agentMessageCount);
for (const key of ['q', 'w', 'e', 'r', 't', 'r', 'e', 'w', 'q']) {
    await page.keyboard.down(key);
    await page.waitForTimeout(260);
    await page.keyboard.up(key);
    await page.waitForTimeout(40);
}
await page.waitForTimeout(answerWait);
// the notes in the agent's messages (messageType.NOTE_LIST = 4)
const answer = await page.evaluate((k) => window.__euterpe.agentMessages(k)
    .flatMap((m) => m.message?.[4] ?? []).map((n) => ({type: n._type, midi: n._midi})), before);
report.agentNoteOns = answer.filter((n) => n.type === 1).map((n) => n.midi);
report.agentNoteOffs = answer.filter((n) => n.type === -1).length;
report.samplesLoaded = samples;
report.failedRequests = failed;
report.errors = errors;
report.ok = report.crossOriginIsolated && report.started && report.ticksPerSecond > 0 && failed.length === 0 &&
    errors.length === 0 && (!process.argv.includes('--expect-answer') || report.agentNoteOns.length > 0);
console.log(JSON.stringify(report, null, 1));
if (process.argv.includes('--logs')) console.log(logs.join('\n'));
const shot = arg('screenshot', null);
if (shot) await page.screenshot({path: shot});
await browser.close();
process.exit(report.ok ? 0 : 1);
