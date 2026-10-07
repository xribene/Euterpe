/**
 * The smoke check of a running Euterpe page, in a headless browser: cross-origin isolated, the agent reports
 * ready, the UI starts, the clock ticks, a phrase played on the laptop keyboard gets an answer from the agent,
 * the samples load, no console errors. Uses Playwright (playwright or playwright-core) with the system Chrome,
 * or Playwright's own Chromium if Chrome isn't installed.
 */

/** Playwright's chromium, from the project's playwright or playwright-core. */
async function loadChromium() {
    for (const name of ['playwright', 'playwright-core']) {
        try {
            return (await import(name)).chromium;
        } catch {
            // try the next one
        }
    }
    throw new Error('the smoke check needs Playwright: npm install --save-dev playwright-core');
}

async function launch() {
    const chromium = await loadChromium();
    const options = {headless: true, args: ['--autoplay-policy=no-user-gesture-required',
        '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream']};
    try {
        return await chromium.launch({...options, channel: 'chrome'});
    } catch (chromeError) {
        try {
            return await chromium.launch(options);
        } catch {
            throw new Error('no browser for the smoke check: install Google Chrome, or run ' +
                '`npx playwright install chromium`\n' + chromeError.message.split('\n')[0]);
        }
    }
}

/**
 * @param {string} url - The page.
 * @param {Object} [options]
 * @param {boolean} [options.expectAnswer] - Fail if the agent plays nothing in answer to the phrase.
 * @param {Array<[string, number, number]>} [options.set] - Widgets to change first: [kind, id, value].
 * @param {number} [options.wait=4000] - How long to wait for the answer after the phrase (ms).
 * @param {string} [options.screenshot] - Save a screenshot here.
 * @return {Promise<Object>} The report; report.ok says whether every check passed.
 */
export async function smoke(url, {expectAnswer = false, set = [], wait = 4000, screenshot = null} = {}) {
    const browser = await launch();
    try {
        const context = await browser.newContext({permissions: ['microphone', 'midi', 'midi-sysex']});
        const page = await context.newPage();
        const errors = [];
        const logs = [];
        const failed = [];
        let samples = 0;
        const onConsole = (source) => (m) => {
            logs.push(`[${source}] ${m.type()}: ${m.text()}`);
            if (m.type() === 'error') errors.push(`[${source}] ${m.text()} ${m.location()?.url ?? ''}`.trim());
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
        // window.__euterpe: the UI's handle for tests (src/utils/handle.js)
        await page.waitForFunction(() => window.__euterpe, null, {timeout: 60000});
        await page.evaluate(() => window.__euterpe.whenReady());
        report.readyAfterMs = Date.now() - t0;
        await page.evaluate(() => window.__euterpe.enter());
        await page.waitForTimeout(500);
        report.started = await page.evaluate(() => window.__euterpe.entered);
        await page.keyboard.press('Escape'); // the intro dialog
        await page.evaluate(() => window.__euterpe.startClock());
        const globalTick = () => page.evaluate(() => window.__euterpe.tick.global);
        await page.waitForTimeout(500);
        const ticks = await globalTick();
        await page.waitForTimeout(1000);
        report.ticksPerSecond = (await globalTick()) - ticks;

        for (const [kind, id, value] of set) {
            await page.evaluate(([k, i, v]) => window.__euterpe.setParam(k, i, v), [kind, id, value]);
        }
        if (set.length) {
            await page.waitForTimeout(300); // the agent reads widget changes every 100 ms
            report.params = await page.evaluate(() => window.__euterpe.params);
        }

        // a phrase on the laptop keyboard (q w e r t = C5 D5 E5 F5 G5), 8th notes at 100 BPM
        report.phrase = [72, 74, 76, 77, 79, 77, 76, 74, 72];
        const before = await page.evaluate(() => window.__euterpe.agentMessageCount);
        // the agent's audio output, if it has one: its loudest moment while the phrase plays and after
        let audioPeak = 0;
        const sampler = setInterval(() => page.evaluate(() => window.__euterpe.audioOut?.peak ?? 0)
            .then((peak) => (audioPeak = Math.max(audioPeak, peak))).catch(() => {}), 100);
        for (const key of ['q', 'w', 'e', 'r', 't', 'r', 'e', 'w', 'q']) {
            await page.keyboard.down(key);
            await page.waitForTimeout(260);
            await page.keyboard.up(key);
            await page.waitForTimeout(40);
        }
        await page.waitForTimeout(wait);
        clearInterval(sampler);
        const audioOut = await page.evaluate(() => window.__euterpe.audioOut);
        if (audioOut) report.audioOut = {...audioOut, peakDuringPhrase: +audioPeak.toFixed(4)};
        // the notes in the agent's messages (messageType.NOTE_LIST = 4)
        const answer = await page.evaluate((k) => window.__euterpe.agentMessages(k)
            .flatMap((m) => m.message?.[4] ?? []).map((n) => ({type: n._type, midi: n._midi})), before);
        report.agentNoteOns = answer.filter((n) => n.type === 1).map((n) => n.midi);
        report.agentNoteOffs = answer.filter((n) => n.type === -1).length;
        report.samplesLoaded = samples;
        report.failedRequests = failed;
        report.errors = errors;
        report.warnings = logs.filter((l) => l.includes('[euterpe]'));
        report.ok = Boolean(report.crossOriginIsolated && report.started && report.ticksPerSecond > 0 &&
            failed.length === 0 && errors.length === 0 &&
            (!expectAnswer || report.agentNoteOns.length > 0 || (report.audioOut?.peakDuringPhrase ?? 0) > 0.01));
        report.logs = logs;
        if (screenshot) await page.screenshot({path: screenshot});
        return report;
    } finally {
        await browser.close();
    }
}
