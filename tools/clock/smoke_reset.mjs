// Playwright smoke test of Reset's bar restart (tick-number.js requestBarReset, `resetsClock` button) with system
// Chrome: for each model, play, press Reset mid-bar and check that the next tick is beat 1 of a new bar (worker
// tick 0 = BachDuet's bar rhythm token, accented metronome click, a new bar number in the score, a 'reset' event
// with barReset in the session log at that tick, globalTick continuous), no misalignment toasts or console errors.
//   node tools/clock/smoke_reset.mjs [port] [--models=0,1,...]   (playwright must be resolvable; see
//   tools/turn-taking/smoke_turntaking.mjs; writes smoke_reset_result.json next to the script)
import {chromium} from 'playwright';
import fs from 'node:fs';

const port = process.argv.find((a) => /^\d+$/.test(a)) ?? '5173';
const modelArg = process.argv.find((a) => a.startsWith('--models='));
const out = new URL('.', import.meta.url).pathname;
const browser = await chromium.launch({channel: 'chrome', headless: true,
    args: ['--autoplay-policy=no-user-gesture-required', '--use-fake-ui-for-media-stream',
        '--use-fake-device-for-media-stream']});
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
    window.__clockEvents = []; // what the main thread sends with each clock event
    window.Worker = class extends W {
        constructor(...a) {
            super(...a);
            if (String(a[0]).includes('agent')) {
                const post = this.postMessage.bind(this);
                this.postMessage = (msg, ...rest) => {
                    if (msg?.hookType === 0 && msg.content) {
                        window.__clockEvents.push({tick: msg.content.tick, globalTick: msg.content.globalTick,
                            barReset: msg.content.barReset});
                    }
                    return post(msg, ...rest);
                };
            }
            this.addEventListener('message', (e) => {
                const m = e.data?.message;
                if (m && m[2] !== undefined && m[1] !== undefined) {
                    window.__agentMsgs.push({tick: m[1], notes: (m[4] || []).map((n) => [n._type ?? n.type, n._midi ?? n.midi])});
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
// the main component (has showSettingsModal) and the score; record metronome clicks and toasts
const MODEL_LABELS = await page.evaluate(() => {
    const find = (vm, f) => f(vm) ? vm : vm.$children.map((c) => find(c, f)).find(Boolean);
    const root = document.getElementById('app').__vue__;
    const main = find(root, (vm) => vm.$options.methods?.showSettingsModal);
    window.__main = main;
    window.__score = find(root, (vm) => vm.currentBarNumber !== undefined && vm.$options.methods?.drawStaff);
    window.__clicks = [];
    main.$store.subscribeAction((action, state) => {
        if (action.type === 'samplerOn' && action.payload?.player === main.playerType.METRONOME) {
            window.__clicks.push({name: action.payload.name, globalTick: state.tickNumber?.globalTick ??
                main.$store.getters.getGlobalTick});
        }
    });
    window.__draws = []; // [globalTickDelayed, score bar number] after each score draw
    const score = window.__score;
    if (score) {
        const draw = score.draw.bind(score);
        score.draw = (...a) => {
            draw(...a);
            window.__draws.push([main.$store.getters.getGlobalTickDelayed, score.currentBarNumber]);
        };
    }
    window.__toasts = [];
    const show = main.$toasted.show.bind(main.$toasted);
    main.$toasted.show = (msg, ...r) => {
        window.__toasts.push(String(msg));
        return show(msg, ...r);
    };
    return main.dropdowns.find((d) => d.id === 2).options;
});
const openSettings = async () => {
    await page.locator('.controlBtn').nth(1).click();
    await page.waitForTimeout(300);
};
const closeSettings = async () => {
    await page.locator('.settingsBtn').first().click();
    await page.waitForTimeout(200);
};
const workerInfo = async () => {
    const w = page.workers().find((x) => x.url().includes('agent'));
    return w.evaluate(() => ({model: self.modelIndex, session: self.session?.ticks.length,
        events: self.session?.events.slice(-12)}));
};
async function chooseModel(index) {
    if ((await workerInfo()).model === index) return;
    const n = logs.length;
    await openSettings();
    await page.selectOption('#dropdown2', String(index));
    await page.waitForTimeout(300);
    await closeSettings();
    const t0 = Date.now();
    while (!logs.slice(n).some((l) => l.includes(`BachDuet model: ${MODEL_LABELS[index]}`))) {
        if (Date.now() - t0 > 90000) throw new Error('model did not load: ' + MODEL_LABELS[index]);
        await page.waitForTimeout(200);
    }
}
const KEY = {72: 'q', 74: 'w', 76: 'e', 77: 'r', 79: 't'};
async function play(mel) {
    const start = performance.now();
    let t = 0;
    for (const [m, n] of mel) {
        const wait = start + t * 150 - performance.now();
        if (wait > 0) await new Promise((r) => setTimeout(r, wait));
        await page.keyboard.down(KEY[m]);
        const hold = start + (t + n) * 150 - 40 - performance.now();
        if (hold > 0) await new Promise((r) => setTimeout(r, hold));
        await page.keyboard.up(KEY[m]);
        t += n;
    }
}
const phrase = [[72, 4], [76, 4], [79, 4], [76, 4], [77, 2], [76, 2], [74, 2], [72, 2], [74, 4], [76, 4]];
const clock = () => page.locator('.controlBtn').nth(0).click();

const res = {};
const models = modelArg ? modelArg.split('=')[1].split(',').map(Number) : MODEL_LABELS.map((_, i) => i);
for (const index of models) {
    await chooseModel(index);
    await clock();
    await page.waitForTimeout(300);
    await play(phrase); // 32 ticks: BachDuet has joined by now
    // press Reset mid-bar: wait for a tick at position 5..9 of the bar
    for (;;) {
        const last = await page.evaluate(() => window.__clockEvents.at(-1));
        if (last && last.tick >= 5 && last.tick <= 9) break;
        await page.waitForTimeout(10);
    }
    const before = await page.evaluate(() => ({ce: window.__clockEvents.length, bar: window.__score?.currentBarNumber,
        clicks: window.__clicks.length, session: null}));
    await openSettings();
    await page.locator('button.agentParameterButton:has-text("Reset")').click();
    await closeSettings();
    await play(phrase);
    await page.waitForTimeout(600);
    const info = await workerInfo();
    await clock();
    await page.waitForTimeout(400);
    const after = await page.evaluate((b) => ({
        ce: window.__clockEvents.slice(b.ce - 3, b.ce + 40), clicks: window.__clicks.slice(b.clicks),
        bar: window.__score?.currentBarNumber, toasts: window.__toasts.slice(), draws: window.__draws.slice(-80)}),
    before);
    const i = after.ce.findIndex((e) => e.barReset);
    const r = {problems: []};
    if (i < 0) {
        r.problems.push('no barReset tick');
    } else {
        const e = after.ce[i];
        const prev = after.ce[i - 1];
        r.resetAt = {interruptedAt: prev.tick, tick: e.tick, globalTick: e.globalTick, prevGlobal: prev.globalTick};
        if (e.tick !== 0) r.problems.push(`tick after Reset is ${e.tick}`);
        if (e.globalTick !== prev.globalTick + 1) r.problems.push('globalTick not continuous');
        if (prev.tick === 15) r.problems.push('Reset landed on a bar line (not mid-bar)');
        // ticks after the restart count from 0
        const later = after.ce.slice(i, i + 20).map((x) => x.tick);
        if (!later.every((t, k) => t === k % 16)) r.problems.push('ticks after Reset: ' + later.join(','));
        const accent = after.clicks.find((c) => c.globalTick === e.globalTick);
        r.metronomeAtReset = accent?.name ?? null;
        if (accent?.name !== 'G0') r.problems.push('no accented click at the restart');
        const resetEv = info.events.filter((x) => x.type === 'reset' && x.barReset);
        r.sessionResetEvents = resetEv.map((x) => x.t);
        if (!resetEv.length) r.problems.push('no barReset event in the session log');
    }
    if (i >= 0) {
        // the score starts a new bar (bar number + 1) exactly at the restart tick
        const g = after.ce[i].globalTick;
        const at = after.draws.find(([t]) => t === g);
        const prevDraw = after.draws.find(([t]) => t === g - 1);
        r.scoreBarAtReset = at && prevDraw ? [prevDraw[1], at[1]] : null;
        if (!at || !prevDraw || at[1] !== prevDraw[1] + 1) r.problems.push('score did not start a new bar at the restart');
    }
    r.toasts = after.toasts.filter((t) => t.includes('misalignment'));
    if (r.toasts.length) r.problems.push('misalignment toasts');
    r.agentNoteOnsAfterReset = (await page.evaluate(() => window.__agentMsgs.slice(-40)))
        .flatMap((x) => x.notes).filter(([type, m]) => type === 1 && m > 0).length;
    res[MODEL_LABELS[index]] = r;
    console.log(MODEL_LABELS[index], JSON.stringify(r));
}
res.errors = errors;
fs.writeFileSync(out + 'smoke_reset_result.json', JSON.stringify({res, logs}, null, 1));
console.log(JSON.stringify({errors}, null, 1));
await browser.close();
