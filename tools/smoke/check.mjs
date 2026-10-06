// Smoke check of a running Euterpe page (dev server or a build behind vite preview), with system Chrome:
// cross-origin isolated, the agent reports ready, the UI starts, the clock ticks, a phrase played on the laptop
// keyboard gets an answer from the agent, samples load, no console errors.
//   node tools/smoke/check.mjs <url> [--expect-answer] [--wait=ms] [--logs] [--screenshot=file.png]
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
// record what the agent and clock workers send
await page.addInitScript(() => {
    const W = window.Worker;
    window.__smoke = {ticks: 0, agentNotes: [], agentMessages: 0};
    window.Worker = class extends W {
        constructor(...a) {
            super(...a);
            const src = String(a[0]);
            this.addEventListener('message', (e) => {
                if (src.includes('clock')) window.__smoke.ticks++;
                if (!src.includes('agentWorker')) return;
                window.__smoke.agentMessages++;
                for (const n of e.data?.message?.[4] ?? []) { // messageType.NOTE_LIST
                    window.__smoke.agentNotes.push({t: performance.now(), type: n._type, midi: n._midi});
                }
            });
        }
    };
});

const report = {url};
const t0 = Date.now();
await page.goto(url);
report.crossOriginIsolated = await page.evaluate(() => self.crossOriginIsolated);
await page.locator('.entryBtn').first().waitFor({state: 'visible', timeout: 180000});
report.readyAfterMs = Date.now() - t0;
for (let i = 0; i < 5; i++) {
    await page.evaluate(() => document.querySelector('.entryBtn').click());
    await page.waitForTimeout(800);
    if (await page.evaluate(() => document.getElementById('mainContent')?.style.display === 'block')) break;
}
report.started = await page.evaluate(() => document.getElementById('mainContent')?.style.display === 'block');
await page.keyboard.press('Escape'); // the intro dialog
await page.mouse.click(5, 5);
// the clock: started by autoStart, otherwise by the play button
let ticks = await page.evaluate(() => window.__smoke.ticks);
await page.waitForTimeout(700);
if (await page.evaluate(() => window.__smoke.ticks) === ticks) await page.locator('.controlBtn').nth(0).click();
await page.waitForTimeout(700);
ticks = await page.evaluate(() => window.__smoke.ticks);
await page.waitForTimeout(1000);
report.ticksPerSecond = (await page.evaluate(() => window.__smoke.ticks)) - ticks;

// a phrase on the laptop keyboard (q w e r t = C5 D5 E5 F5 G5), 8th notes at 100 BPM
const before = await page.evaluate(() => window.__smoke.agentNotes.length);
for (const key of ['q', 'w', 'e', 'r', 't', 'r', 'e', 'w', 'q']) {
    await page.keyboard.down(key);
    await page.waitForTimeout(260);
    await page.keyboard.up(key);
    await page.waitForTimeout(40);
}
await page.waitForTimeout(answerWait);
const answer = await page.evaluate((k) => window.__smoke.agentNotes.slice(k), before);
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
