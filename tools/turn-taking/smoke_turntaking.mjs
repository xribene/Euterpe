// Playwright smoke test of BachDuet's turn-taking (src/agent/turnTaking.js) on the dev server, with system Chrome.
// Plays a 2-bar phrase, 3 bars of rest, another phrase and rest on the laptop keyboard, saves the session and
// checks: silence while listening, entry on a beat a bar after the user's first note, drop-out after 2 bars of
// user silence, re-entry, the "Listen 0 / Stop 0" sliders (old behaviour), every model still playing, no console
// errors, flat worker memory.
//   node tools/turn-taking/smoke_turntaking.mjs [port] [--models=0,1,...]   (needs the playwright package
//   resolvable, e.g. a copy of this script next to a node_modules with playwright; writes smoke_result.json there)
import {chromium} from 'playwright';
import fs from 'node:fs';

const port = process.argv.find((a) => /^\d+$/.test(a)) ?? '5173';
const modelArg = process.argv.find((a) => a.startsWith('--models='));
const out = new URL('.', import.meta.url).pathname;
const browser = await chromium.launch({channel: 'chrome', headless: true,
    args: ['--autoplay-policy=no-user-gesture-required', '--use-fake-ui-for-media-stream',
        '--use-fake-device-for-media-stream', '--enable-precise-memory-info', '--enable-blink-features=ForceEagerMeasureMemory']});
const context = await browser.newContext({acceptDownloads: true, permissions: ['microphone', 'midi', 'midi-sysex']});
const page = await context.newPage();
const logs = [];
const errors = [];
const onConsole = (src) => (m) => {
    const s = `[${src}] ${m.type()}: ${m.text()}`;
    logs.push(s);
    if (m.type() === 'error') errors.push(s);
};
page.on('console', onConsole('page'));
page.on('pageerror', (e) => errors.push('[pageerror] ' + e.message));
page.on('worker', (w) => w.on('console', onConsole('worker')));
await page.addInitScript(() => {
    const W = window.Worker;
    window.__agentMsgs = [];
    window.Worker = class extends W {
        constructor(...a) {
            super(...a);
            this.addEventListener('message', (e) => {
                const m = e.data?.message;
                if (m && m[2] !== undefined && m[1] !== undefined) {
                    window.__agentMsgs.push({t: performance.now(), tick: m[1], inf: m[2],
                        notes: (m[4] || []).map((n) => [n._type ?? n.type, n._midi ?? n.midi])});
                }
            });
        }
    };
});
await page.goto(`http://localhost:${port}/`);
await page.locator('.entryBtn').first().waitFor({state: 'visible', timeout: 120000});
await page.getByText('The Agent is ready to interact with you!').waitFor({timeout: 180000});
await page.waitForTimeout(1500);
for (let i = 0; i < 5; i++) {
    await page.evaluate(() => document.querySelector('.entryBtn').click());
    await page.waitForTimeout(800);
    if (await page.evaluate(() => document.getElementById('mainContent').style.display === 'block')) break;
}
await page.keyboard.press('Escape');
await page.mouse.click(5, 5);
await page.waitForTimeout(500);

const MODEL_LABELS = await page.evaluate(() => {
    // the Model dropdown's options, from the component that opens the Settings modal
    const find = (vm) => vm.$options.methods?.showSettingsModal ? vm : vm.$children.map(find).find(Boolean);
    const main = find(document.getElementById('app').__vue__);
    return main.dropdowns.find((d) => d.id === 2).options;
});
const openSettings = async () => {
    await page.locator('.controlBtn').nth(1).click();
    await page.waitForTimeout(400);
};
const closeSettings = async () => {
    await page.locator('.settingsBtn').first().click();
    await page.waitForTimeout(300);
};
async function chooseModel(index) {
    const label = MODEL_LABELS[index];
    if ((await heap()).model === index) return;
    const n = logs.length;
    await openSettings();
    await page.selectOption('#dropdown2', String(index));
    await page.waitForTimeout(300);
    await closeSettings();
    const t0 = Date.now();
    while (!logs.slice(n).some((l) => l.includes(`BachDuet model: ${label}`))) {
        if (Date.now() - t0 > 90000) throw new Error('model did not load: ' + label);
        await page.waitForTimeout(200);
    }
    await page.waitForTimeout(300);
}
async function setSlider(labelStart, value) {
    await openSettings();
    await page.evaluate(([l, v]) => {
        const box = [...document.querySelectorAll('.horizontal-slider')]
            .find((b) => b.querySelector('.label')?.textContent.startsWith(l));
        const input = box.querySelector('input');
        input.value = String(v);
        input.dispatchEvent(new Event('input'));
        input.dispatchEvent(new Event('change'));
    }, [labelStart, value]);
    await page.waitForTimeout(300);
    await closeSettings();
}
async function pressReset() {
    await openSettings();
    await page.locator('button.agentParameterButton:has-text("Reset")').click();
    await page.waitForTimeout(300);
    await closeSettings();
}

const SIX = 150; // ms per 16th at 100 BPM
const KEY = {72: 'q', 74: 'w', 76: 'e', 77: 'r', 79: 't', 81: 'y', 83: 'u', 84: 'i'};
const phraseA = [[72, 4], [76, 4], [79, 4], [76, 4], [77, 2], [76, 2], [74, 2], [72, 2], [74, 8]];
const phraseB = [[79, 4], [77, 4], [76, 4], [74, 4], [72, 2], [74, 2], [76, 4], [72, 8]];
async function play(mel) {
    const start = performance.now();
    let t = 0;
    for (const [m, n] of mel) {
        const wait = start + t * SIX - performance.now();
        if (wait > 0) await new Promise((r) => setTimeout(r, wait));
        if (m) {
            await page.keyboard.down(KEY[m]);
            const hold = start + (t + n) * SIX - 40 - performance.now();
            if (hold > 0) await new Promise((r) => setTimeout(r, hold));
            await page.keyboard.up(KEY[m]);
        }
        t += n;
    }
    const wait = start + t * SIX - performance.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
}
const heap = async () => {
    const w = page.workers().find((x) => x.url().includes('agent'));
    const info = w ? await w.evaluate(() => ({tensors: self.tf?.memory().numTensors, model: self.modelIndex,
        session: self.session?.ticks.length})) : {};
    // JS + WASM heaps of the agent worker (measureUserAgentSpecificMemory needs the cross-origin isolated page)
    const mem = await page.evaluate(async () => {
        const r = await performance.measureUserAgentSpecificMemory();
        return r.breakdown.filter((b) => b.attribution.some((a) => a.scope === 'DedicatedWorkerGlobalScope'))
            .map((b) => [b.bytes, b.attribution.map((a) => a.url).join(',')]);
    }).catch((e) => String(e));
    const bytes = Array.isArray(mem) ? mem.filter(([, u]) => u.includes('agent')).reduce((a, [b]) => a + b, 0) : mem;
    return {...info, agentWorkerMB: typeof bytes === 'number' ? +(bytes / 1e6).toFixed(2) : bytes};
};
async function waitBar() {
    const n = await page.evaluate(() => window.__agentMsgs.length);
    for (;;) {
        const last = await page.evaluate((k) => window.__agentMsgs.slice(k).pop(), n);
        if (last && last.tick === 14) {
            await page.waitForTimeout(150 + 40);
            return;
        }
        await page.waitForTimeout(10);
    }
}
async function saveSession(tag) {
    await openSettings();
    const downloads = [];
    const handler = (d) => downloads.push(d);
    page.on('download', handler);
    await page.locator('button.agentParameterButton:has-text("Save session")').click();
    await page.waitForTimeout(2500);
    page.off('download', handler);
    await closeSettings();
    let json = null;
    for (const d of downloads) {
        const p = out + tag + '_' + d.suggestedFilename();
        await d.saveAs(p);
        if (p.endsWith('.json')) json = JSON.parse(fs.readFileSync(p));
    }
    return json;
}
const clock = () => page.locator('.controlBtn').nth(0).click();

// Checks a saved session (from row `from`) against the turn-taking rules: silent until a join, the join on a beat
// >= 16 ticks after the phrase's first note, a stop after >= stopTicks of user silence, silent between a stop and
// the next join.
function analyse(session, from = 0, {listen = 16, stop = 32} = {}) {
    const c = Object.fromEntries(session.tickColumns.map((n, i) => [n, i]));
    const rows = session.ticks;
    const ev = session.events.filter((e) => e.type === 'turn' && e.t >= from);
    const res = {joins: [], stops: [], problems: []};
    let listening = true;
    let phraseStart = null;
    let silence = 0;
    for (let t = from; t < rows.length; t++) {
        const r = rows[t];
        const userOn = r[c.userMidi] > 0;
        silence = userOn ? 0 : silence + 1;
        if (listening && phraseStart === null && userOn) phraseStart = t;
        const e = ev.find((x) => x.t === t && (x.event === 'join' || x.event === 'stop'));
        if (e?.event === 'join') {
            const beat = (r[c.tickInBar] + 1) % 4 === 0;
            const heard = t - phraseStart + 1;
            res.joins.push({t, tickInBar: r[c.tickInBar], heard, onBeat: beat});
            if (!beat) res.problems.push(`join off the beat at ${t}`);
            if (heard < listen) res.problems.push(`join after only ${heard} ticks at ${t}`);
            listening = false;
        } else if (e?.event === 'stop') {
            res.stops.push({t, userSilence: silence});
            if (silence < stop) res.problems.push(`stop after only ${silence} ticks of silence at ${t}`);
            listening = true;
            phraseStart = null;
        }
        if (listening && r[c.agentMidi] !== 0) res.problems.push(`sound while listening at ${t}`);
        if (!listening && silence > stop + 17) res.problems.push(`still playing after ${silence} ticks of silence at ${t}`);
    }
    return res;
}

const res = {};
// ---- default model, default sliders: listen 1 bar, stop after 2 bars
await clock();
await page.waitForTimeout(600);
const heaps = [await heap()];
const rows0 = (await heap()).session;
await waitBar();
await play([...phraseA, [0, 48], ...phraseB, [0, 48]]);
heaps.push(await heap());
await play([...phraseA, [0, 48], ...phraseB, [0, 48]]);
heaps.push(await heap());
let session = await saveSession('default');
res.defaults = analyse(session, rows0);
res.defaults.firstEvents = session.events.slice(0, 6).map((e) => `${e.t}:${e.type}:${e.event ?? ''}`);
res.defaults.agentOnsets = session.ticks.slice(rows0).filter((r) => r[4] === 1 && r[3] > 0).length;
res.worker = heaps;
console.log('defaults', JSON.stringify(res.defaults));
await clock();
await page.waitForTimeout(500);

// ---- sliders: Listen 0, Stop 0 = the old behaviour (plays at once, never stops)
await setSlider('Listen before joining', 0);
await setSlider('Stop after silence', 0);
await pressReset();
await clock();
await page.waitForTimeout(400);
let n0 = (await heap()).session;
await waitBar();
await play([...phraseA, [0, 48]]);
session = await saveSession('old');
const tail = session.ticks.slice(n0);
res.oldBehaviour = {ticks: tail.length, agentSoundingShare: +(tail.filter((r) => r[3] > 0).length / tail.length).toFixed(2),
    turnEvents: session.events.filter((e) => e.type === 'turn' && e.t >= n0).map((e) => e.event),
    agentSoundingDuringFinalRest: tail.slice(-40).filter((r) => r[3] > 0).length};
await clock();
await page.waitForTimeout(400);
// ---- back to the defaults, Stop after 1 bar
await setSlider('Listen before joining', 1);
await setSlider('Stop after silence', 1);
await pressReset();
await clock();
await page.waitForTimeout(400);
n0 = (await heap()).session;
await waitBar();
await play([...phraseA, [0, 32], ...phraseB, [0, 32]]);
session = await saveSession('stop1');
res.stop1 = analyse(session, n0, {stop: 16});
await clock();
await page.waitForTimeout(400);
await setSlider('Stop after silence', 2);

// ---- every model still plays (with turn-taking)
const models = modelArg ? modelArg.split('=')[1].split(',').map(Number) : MODEL_LABELS.map((_, i) => i);
const q = (a, f) => (a.length ? +a[Math.floor((a.length - 1) * f)].toFixed(2) : null);
for (const index of models) {
    await chooseModel(index);
    await clock();
    await page.waitForTimeout(400);
    const n = await page.evaluate(() => window.__agentMsgs.length);
    const s0 = (await heap()).session;
    await waitBar();
    await play([...phraseA, ...phraseB, [0, 40]]);
    const m = await page.evaluate((k) => window.__agentMsgs.slice(k), n);
    const sess = await saveSession('model' + index);
    await clock();
    await page.waitForTimeout(400);
    const infs = m.map((x) => x.inf).sort((a, b) => a - b);
    const a = analyse(sess, s0);
    res[MODEL_LABELS[index]] = {joins: a.joins.length, stops: a.stops.length, problems: a.problems,
        agentNoteOns: m.flatMap((x) => x.notes).filter(([type, midi]) => type === 1 && midi > 0).length,
        inferMedian: q(infs, 0.5), inferMax: q(infs, 1), worker: await heap()};
}
res.errors = errors;
res.turnLogs = logs.filter((l) => /joins|stops and listens|turn-taking/.test(l)).slice(0, 10);
console.log(JSON.stringify(res, null, 1));
fs.writeFileSync(out + 'smoke_result.json', JSON.stringify({res, logs}, null, 1));
await browser.close();
