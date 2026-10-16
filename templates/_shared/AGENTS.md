# Working on this Euterpe agent

This project is a real-time interactive music agent built on [Euterpe](https://github.com/xribene/Euterpe): a human plays (laptop keyboard, MIDI keyboard or microphone) and the agent answers in the browser. Euterpe (in `node_modules/euterpe`) does the input, clock, quantization, samplers and UI; this project holds only the agent.

## Layout

```text
agent/hooks.js      the agent: defineAgent({...hooks})
agent/config.yaml   interaction mode (gridBased / eventBased / audioMode), clock, BPM
agent/widgets.yaml  what the UI shows (score, piano roll, ...) and the Settings widgets (sliders, switches, buttons, dropdowns, text fields)
agent/players.yaml  players (user, agent, metronome) and their instruments
agent/intro.md      the text shown when the page opens
public/             static files served as-is, e.g. model weights (fetch('/checkpoints/model.onnx'))
index.html          the page: calls mount() from 'euterpe'; the project's own page code (e.g. a custom widget) goes here
```

Change these files. Do not edit `node_modules/euterpe` in place (see "Changing Euterpe itself").

## The hooks (agent/hooks.js)

```js
import {defineAgent} from 'euterpe/agent';

export default defineAgent({
    async loadAlgorithm(ctx) {},              // once; load models here; the UI waits for it
    processClockEvent(clock, ctx) {},         // every tick, if config.yaml gridBased.status: true
    processNoteEvent(noteEvent, ctx) {},      // every user note, if eventBased.status: true
    processAudioBuffer(channels, ctx) {},     // every microphone frame, if interactionMode.audioMode: true
    updateParameter({kind, id, value}, ctx) {}, // a Settings widget changed
    renderAudio(frames, ctx) {},              // audio output, if interactionMode.audioOut: true (see below)
    processPageMessage(data, ctx) {},         // the page's own code called sendToAgent(data) (see docs/page-code.md)
});
```

- Every hook is optional and may be `async`. The hooks run in a Web Worker: no DOM, no `window`.
- `clock`: `tick` (position in the bar), `globalTick`, `barReset` (the bar restarted), `userQuantizedNotes` (the user's notes on this tick, if `gridBased.quantizedEvents: true`), `userNotes` (raw notes since the last tick, if `gridBased.eventBuffer: true`).
- A note (`NoteEvent`): `midi`, `type` (`ctx.types.noteType`: `NOTE_ON` 1, `NOTE_OFF` -1, `NOTE_HOLD` 0), `velocity`, `createdAt` (`{tick, seconds}`: when it was played; `seconds` is on the page's clock, the same as `ctx.now()`).
- `processClockEvent`, `processNoteEvent`, `processAudioBuffer`, `updateParameter` and `processPageMessage` return what the agent plays and shows: an array of notes, or `{notes, text, label, vector, key, audio, page}`, or nothing (`loadAlgorithm` uses `ctx.send` instead). `page` goes to the page code's `onAgentMessage` listeners.
- The time budget of `processClockEvent` is one tick (150 ms at 100 BPM in 16ths). A note scheduled for a tick that has already passed is dropped.

## ctx

| | |
|---|---|
| `ctx.noteOn(midi, {tick, seconds, velocity, instrument, duration})`, `ctx.noteOff(midi, {...})` | A note to return. `tick`: ticks from now (0: at once); `instrument`: `'piano'`, `'drums'`, `'bass'`, `'synth'` |
| `ctx.params.slider[1]`, `.switch[1]`, `.dropdown[1]`, `.button[1]`, `.text[1]` | Current widget values (starting from widgets.yaml), by the widget's `id` in widgets.yaml. A text field (`settingsModal.textFields`, e.g. a prompt) updates when the user presses Enter or leaves the field |
| `ctx.now()` | Seconds on the page's clock (compare with a note's `createdAt.seconds`) |
| `ctx.config` | The merged YAML files |
| `ctx.send({text})` | Send output outside a hook's return (e.g. loading progress) |
| `ctx.monitor(id, value)` | Plot a value in the Monitor widget (widgets.yaml `gui.monitor`; the Monitor and the Mixer start closed, `gui.monitor.open` / `gui.mixer.open: true` show them at load) |
| `ctx.audio` | `{sampleRate, channelCount}` once the microphone runs |
| `ctx.audioOut` | The agent's audio output (see below), or `null` |
| `ctx.types` | `noteType`, `playerType`, `instrumentType`, `messageType`, `statusType` |
| `ctx.urlParams` | The page's query parameters |

`euterpe/agent` also exports `NoteEvent`, `clamp`, `clampMidi`, `LIFOQueue`, `FIFOQueue`, `deinterleaveCustom`, and small array helpers (`shiftRight`, `max1d`, `average1d`, `average2d`).

## Audio input

With `interactionMode.audioMode: true` the agent gets the microphone in `processAudioBuffer(frame, ctx)`: `frame` is one `Float32Array` per channel (2; a mono microphone is copied to both) of `audioModeSettings.windowSize` samples, every `hopSize` samples, at `audioModeSettings.sampleRate` (resampled; default the page's 44.1 or 48 kHz). `frame.start` is its position in samples since the microphone started and `frame.time` when it was captured (page clock, like `ctx.now()` and notes' `createdAt.seconds`). The browser's speech processing (echo cancellation, noise suppression, automatic gain) is off unless `audioModeSettings` turns it on. For a longer context than one window, keep your own history of frames in `hooks.js`.

## Audio output

An agent can play audio it generates (synthesis, a neural audio model), besides or instead of notes. In `config.yaml`:

```yaml
interactionMode:
  audioOut: true
audioOutSettings:
  channels: 2     # 1 (mono, on both speakers) or 2
  latency: 0.1    # seconds queued ahead of playback: more = fewer dropouts, later sound
```

`audioOutSettings.sampleRate` sets the rate the agent writes at (Euterpe resamples it to the page's), and `audioOutSettings.blockSize` makes `renderAudio` always ask for exactly that many frames (for models with a fixed block size). `ctx.audioOut.playTime()` says when audio written now will be heard (page clock, like `ctx.now()`).

Then either let Euterpe ask for audio (`renderAudio(frames, ctx)` is called whenever less than `latency` seconds are queued; return one `Float32Array` per channel, or one for all), or push it yourself (`ctx.audioOut.write(channels)` anywhere, or `{audio: channels}` returned from `processClockEvent`, `processNoteEvent`, `processAudioBuffer` or `updateParameter`; `ctx.audioOut.space()` and `.buffered()` say how much fits / is queued). The audio plays through the agent's mixer channel, from the start button on, at `ctx.audioOut.sampleRate`. Euterpe keeps at least two audio blocks (256 frames) queued whatever `latency` says. If the agent doesn't keep up, the output plays silence until `latency / 2` is queued again and the console says `[euterpe] the agent's audio output ran dry`. The sound lags by about `latency`.

## Guides in node_modules/euterpe/docs

Read these before doing the thing they cover:

- `models.md`: loading a model in the agent worker (TF.js WASM backend, onnxruntime-web, `.wasm` files through Vite `?url` imports, `public/` paths, warm-up).
- `hosting.md`: cross-origin isolation (COOP/COEP), which hosts set it, coi-serviceworker for hosts that can't.
- `testing.md`: `npm run smoke`, Playwright with the system Chrome, the full `window.__euterpe` API, console messages that look like errors but aren't (no Web MIDI in headless Chrome, the intro dialog, the icon font offline).
- `page-code.md`: a widget of the project's own in `index.html` that sends input to the agent (`mount()` returns `sendToAgent` / `onAgentMessage`; the agent's `processPageMessage` hook), and which laptop keys Euterpe already uses.

## Commands

```bash
npm run dev       # dev server with the full UI; agent/ changes reload the page
npm run build     # static site in dist/ (needs COOP/COEP headers: netlify.toml and vercel.json are set up)
npm run preview   # serve dist/ locally with the headers
npm run typecheck # check agent/ against Euterpe's types (hooks, ctx, notes, config)
npm run smoke     # headless browser check: page isolated, agent ready, clock ticking, answers a phrase, no errors
npm run smoke -- --build   # the same on the production build, served like a static host
```

`agent/hooks.js` is JavaScript checked by TypeScript (`// @ts-check`, `jsconfig.json`): hook names, `ctx`, note helpers and `ctx.config` are typed, so editors autocomplete them and `npm run typecheck` catches a misspelled hook or a note given as a string. Renaming it to `hooks.ts` works too.

## Checking your work

- Run `npm run typecheck` and `npm run smoke` after a change. `smoke` starts the dev server, plays C5 D5 E5 F5 G5 F5 E5 D5 C5 on the laptop keyboard and reports what the agent played back, console errors and Euterpe's warnings (`--set=slider:1:40` changes a widget first, `--json` for the full report). It uses the system Chrome; without Chrome run `npx playwright install chromium` once. A headless browser often has no Web MIDI; that is not counted as an error (the report says so in an info line).
- The YAML files are checked against `node_modules/euterpe/schema/*.schema.json` when the dev server or the build loads them: errors (missing keys, wrong types, unknown instruments) stop the dev server with an overlay and fail the build; warnings (unknown keys, with a "did you mean") are printed in the terminal and the browser console. Editors with the YAML extension validate and autocomplete them (the first line of each file points to its schema).
- Open the dev server URL, press the start button, play on the keyboard (rows `Z X C V ...` = C4 upward, `Q W E R ...` = C5 upward) or a MIDI keyboard (the first connected MIDI input is used until another one is chosen in Settings), and watch the browser console. Space starts and stops the clock (not while the intro or Settings dialog is open). Euterpe's own messages start with `[euterpe]`: a hook that returned something that isn't a note, an unknown key, a `processClockEvent` slower than a tick, notes dropped because they arrived after their tick.
- The page must be cross-origin isolated (`self.crossOriginIsolated === true` in the console); the dev server and the provided deploy configs make sure of that.
- Scripts and browser tests (e.g. Playwright) drive the page through `window.__euterpe` instead of clicking: `await __euterpe.whenReady()`, `__euterpe.enter()`, `__euterpe.startClock()`, `__euterpe.noteOn(60)` / `noteOff(60)`, `__euterpe.setParam('slider', 1, 40)`, `__euterpe.params`, `__euterpe.tick`, `__euterpe.agentMessages()` (what the agent sent). Controls carry `data-testid`s: `euterpe-start`, `euterpe-clock`, `euterpe-settings`, `euterpe-slider-1`, `euterpe-dropdown-1`, `euterpe-text-1`, ...

## Agents with a neural network

The pattern: the model runs in the agent's worker (load it in `loadAlgorithm`, which the UI waits for), its weights are static files in `public/` (fetched with `fetch('/checkpoints/...')`), and `processClockEvent` runs one inference step per tick, keeping the model's state (an RNN's hidden state, a transformer's KV cache) between ticks. Check that a step fits in a tick: the console warns when `processClockEvent` is slower than one.

Add the runtime as a dependency (`npm install onnxruntime-web` or `@tensorflow/tfjs @tensorflow/tfjs-backend-wasm`) and import it in `agent/`; Euterpe's Vite plugin pre-bundles whatever the agent imports.

## Changing Euterpe itself

Euterpe's source ships readable in `node_modules/euterpe/src` (Vue 2 UI in `src/views/Euterpe.vue`, the worker runtime in `src/worker/agentWorker.js`, the Vite plugin in `vite/index.js`). Do not edit it in place: the next install discards the change. Instead:

- **Report it:** a bug, a missing feature or an unclear message in Euterpe goes to https://github.com/xribene/Euterpe/issues, with the Euterpe version (`node_modules/euterpe/package.json`), what you did, what you expected and what happened (the `npm run smoke -- --json` report helps). Fixes are welcome as pull requests too.
- **Patch it:** for a small fix in this project, `npx patch-package euterpe` (npm) or `pnpm patch euterpe` (pnpm) keeps the change as a patch file that is re-applied on every install.
- **Copy it into the project:** `npx euterpe eject` copies Euterpe into `./euterpe` and points `package.json` at that copy. It is then ordinary project code you can change freely (and no longer updates with new Euterpe releases).
