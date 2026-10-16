# Testing an agent in a browser

## npm run smoke

```bash
npm run smoke                 # starts the dev server, checks the page in headless Chrome
npm run smoke -- --build      # the same on the production build, served with the COOP/COEP headers
npm run smoke -- --json       # the full report (add --logs for the console)
npm run smoke -- --set=slider:1:40 --screenshot=shot.png --wait=6000
```

It checks: the page is cross-origin isolated, the agent loads, the start button works, the clock ticks; then it plays C5 D5 E5 F5 G5 F5 E5 D5 C5 on the laptop keyboard (`q w e r t`) and reports what the agent played, console errors and Euterpe's `[euterpe]` warnings. `--expect-answer` fails if the agent plays nothing. It uses the system Chrome; without one, run `npx playwright install chromium` once.

## Your own tests: Playwright + window.__euterpe

Use the system Chrome (no browser download) and drive the page through `window.__euterpe` rather than clicking through the UI:

```js
import {chromium} from 'playwright-core';   // already in the project's devDependencies

const browser = await chromium.launch({channel: 'chrome'});
const page = await browser.newPage();
await page.goto('http://localhost:5173/');
await page.waitForFunction(() => window.__euterpe);
await page.evaluate(() => __euterpe.whenReady());   // the agent loaded (loadAlgorithm resolved)
await page.evaluate(() => __euterpe.enter());       // what the start button does; it opens the intro dialog
await page.keyboard.press('Escape');                // close the intro dialog
await page.evaluate(() => __euterpe.startClock());
const n = await page.evaluate(() => __euterpe.agentMessageCount);
await page.evaluate(() => __euterpe.noteOn(60));
await page.waitForTimeout(500);
await page.evaluate(() => __euterpe.noteOff(60));
const notes = await page.evaluate((k) => __euterpe.agentMessages(k).flatMap((m) => m.message[4] ?? []), n);
```

`window.__euterpe` (types: `EuterpeHandle` in `euterpe`):

| | |
|---|---|
| `ready`, `whenReady(timeoutMs = 180000)` | The agent has loaded and the permissions are granted |
| `entered`, `enter()` | The start button was pressed / press it |
| `clockRunning`, `startClock()`, `stopClock()` | The clock (grid mode) |
| `tick` | `{local, global}`: the position in the bar, ticks since the start |
| `bpm`, `setBPM(bpm)` | The tempo |
| `params`, `setParam(kind, id, value)` | Widget values as the agent's `ctx.params` sees them; `kind`: `'slider'`, `'switch'`, `'dropdown'`, `'button'` (presses it), `'text'` |
| `noteOn(midi, velocity = 127)`, `noteOff(midi)` | A user note, as from the laptop keyboard (lights the on-screen key) |
| `agentMessages(since = 0)`, `agentMessageCount` | What the agent sent: `[{t, hookType, message}]`, numbered from the first message. `message` is keyed by `messageType` number: `message[4]` is the note list, `message[13]` the text |
| `audioOut` | The agent's audio output: `{played, underruns, playing, quantum, peak}`, or `null` |
| `config` | The merged YAML config |

Notes in `agentMessages` are serialized `NoteEvent`s: read `n._midi`, `n._type` (1 on, -1 off), `n._playAfter`.

The controls carry `data-testid`s: `euterpe-start`, `euterpe-clock`, `euterpe-settings`, `euterpe-slider-1`, `euterpe-dropdown-1`, `euterpe-text-1`, ...

## Messages that look like errors but aren't

- **`WebMidi is not enabled`, `NotAllowedError ... MIDI`, `[euterpe] Web MIDI is not available`.** Headless Chrome has no Web MIDI (no devices, or the permission refused). MIDI devices are simply off; the laptop keyboard, the on-screen keyboard and `__euterpe.noteOn` still work. `npm run smoke` doesn't count these as errors.
- **`The AudioContext was not allowed to start`.** The browser's autoplay policy, before the start button (the user gesture that resumes audio).
- **The intro dialog.** `enter()` (the start button) opens it. While it is open it covers the middle of the page and Space doesn't start or stop the clock (Euterpe's shortcuts are off while any dialog is open); laptop-keyboard notes still play. Close it with Escape before clicking or pressing Space in a test.
- **Icons shown as words** (e.g. `settings`, `play_arrow`). Euterpe's icon font comes from Google Fonts; offline it doesn't load and the icon names show as text. Nothing else is affected.
