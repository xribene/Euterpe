# Working on this Euterpe agent

This project is a real-time interactive music agent built on [Euterpe](https://github.com/xribene/Euterpe): a human plays (laptop keyboard, MIDI keyboard or microphone) and the agent answers in the browser. Euterpe (in `node_modules/euterpe`) does the input, clock, quantization, samplers and UI; this project holds only the agent.

## Layout

```text
agent/hooks.js      the agent: defineAgent({...hooks})
agent/config.yaml   interaction mode (gridBased / eventBased / audioMode), clock, BPM
agent/widgets.yaml  what the UI shows (score, piano roll, ...) and the Settings widgets (sliders, switches, buttons, dropdowns)
agent/players.yaml  players (user, agent, metronome) and their instruments
agent/intro.md      the text shown when the page opens
public/             static files served as-is, e.g. model weights (fetch('/checkpoints/model.onnx'))
```

Change these files. Do not edit `node_modules/euterpe` (see "Changing Euterpe itself").

## The hooks (agent/hooks.js)

```js
import {defineAgent} from 'euterpe/agent';

export default defineAgent({
    async loadAlgorithm(ctx) {},              // once; load models here; the UI waits for it
    processClockEvent(clock, ctx) {},         // every tick, if config.yaml gridBased.status: true
    processNoteEvent(noteEvent, ctx) {},      // every user note, if eventBased.status: true
    processAudioBuffer(channels, ctx) {},     // every microphone frame, if interactionMode.audioMode: true
    updateParameter({kind, id, value}, ctx) {}, // a Settings widget changed
});
```

- Every hook is optional and may be `async`. The hooks run in a Web Worker: no DOM, no `window`.
- `clock`: `tick` (position in the bar), `globalTick`, `barReset` (the bar restarted), `userQuantizedNotes` (the user's notes on this tick, if `gridBased.quantizedEvents: true`), `userNotes` (raw notes since the last tick, if `gridBased.eventBuffer: true`).
- A note (`NoteEvent`): `midi`, `type` (`ctx.types.noteType`: `NOTE_ON` 1, `NOTE_OFF` -1, `NOTE_HOLD` 0), `velocity`, `createdAt` (`{tick, seconds}`: when it was played; `seconds` is on the page's clock, the same as `ctx.now()`).
- Return what the agent plays and shows: an array of notes, or `{notes, text, label, vector, key}`, or nothing.
- The time budget of `processClockEvent` is one tick (150 ms at 100 BPM in 16ths). A note scheduled for a tick that has already passed is dropped.

## ctx

| | |
|---|---|
| `ctx.noteOn(midi, {tick, seconds, velocity, instrument, duration})`, `ctx.noteOff(midi, {...})` | A note to return. `tick`: ticks from now (0: at once); `instrument`: `'piano'`, `'drums'`, `'bass'`, `'synth'` |
| `ctx.params.slider[1]`, `.switch[1]`, `.dropdown[1]`, `.button[1]` | Current widget values (starting from widgets.yaml), by the widget's `id` in widgets.yaml |
| `ctx.now()` | Seconds on the page's clock (compare with a note's `createdAt.seconds`) |
| `ctx.config` | The merged YAML files |
| `ctx.send({text})` | Send output outside a hook's return (e.g. loading progress) |
| `ctx.monitor(id, value)` | Plot a value in the Monitor widget (widgets.yaml `gui.monitor`) |
| `ctx.audio` | `{sampleRate, channelCount}` once the microphone runs |
| `ctx.types` | `noteType`, `playerType`, `instrumentType`, `messageType`, `statusType` |
| `ctx.urlParams` | The page's query parameters |

`euterpe/agent` also exports `NoteEvent`, `clamp`, `clampMidi`, `LIFOQueue`, `FIFOQueue`.

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

- Run `npm run typecheck` and `npm run smoke` after a change. `smoke` starts the dev server, plays C5 D5 E5 F5 G5 F5 E5 D5 C5 on the laptop keyboard and reports what the agent played back, console errors and Euterpe's warnings (`--set=slider:1:40` changes a widget first, `--json` for the full report). It uses the system Chrome; without Chrome run `npx playwright install chromium` once.
- The YAML files are checked against `node_modules/euterpe/schema/*.schema.json` when the dev server or the build loads them: errors (missing keys, wrong types, unknown instruments) stop the dev server with an overlay and fail the build; warnings (unknown keys, with a "did you mean") are printed in the terminal and the browser console. Editors with the YAML extension validate and autocomplete them (the first line of each file points to its schema).
- Open the dev server URL, press the start button, play on the keyboard (rows `Z X C V ...` = C4 upward, `Q W E R ...` = C5 upward), and watch the browser console. Euterpe's own messages start with `[euterpe]`: a hook that returned something that isn't a note, an unknown key, a `processClockEvent` slower than a tick, notes dropped because they arrived after their tick.
- The page must be cross-origin isolated (`self.crossOriginIsolated === true` in the console); the dev server and the provided deploy configs make sure of that.
- Scripts and browser tests (e.g. Playwright) drive the page through `window.__euterpe` instead of clicking: `await __euterpe.whenReady()`, `__euterpe.enter()`, `__euterpe.startClock()`, `__euterpe.noteOn(60)` / `noteOff(60)`, `__euterpe.setParam('slider', 1, 40)`, `__euterpe.params`, `__euterpe.tick`, `__euterpe.agentMessages()` (what the agent sent). Controls carry `data-testid`s: `euterpe-start`, `euterpe-clock`, `euterpe-settings`, `euterpe-slider-1`, `euterpe-dropdown-1`, ...

## Agents with a neural network

Two complete projects in the Euterpe repository show the pattern (model in the worker, weights in `public/`, one inference step per tick):

- [apps/realchords](https://github.com/xribene/Euterpe/tree/main/apps/realchords): ONNX transformer with a KV cache (onnxruntime-web), `defineAgent`, polyphonic output, a parity test against PyTorch.
- [apps/bachduet](https://github.com/xribene/Euterpe/tree/main/apps/bachduet): LSTMs in TF.js (WASM backend), several models behind a dropdown, turn-taking, session logging.

Add the runtime as a dependency (`npm install onnxruntime-web` or `@tensorflow/tfjs @tensorflow/tfjs-backend-wasm`) and import it in `agent/`; Euterpe's Vite plugin pre-bundles whatever the agent imports.

## Changing Euterpe itself

Euterpe's source ships readable in `node_modules/euterpe/src` (Vue 2 UI in `src/views/Euterpe.vue`, the worker runtime in `src/worker/agentWorker.js`, the Vite plugin in `vite/index.js`). Do not edit it in place: the next install discards the change. For a small fix use `npx patch-package euterpe` (npm) or `pnpm patch euterpe` (pnpm), which keep the change as a patch file in the project. For bigger changes, `npx euterpe eject` copies Euterpe into `./euterpe` and points `package.json` at it; then it is ordinary project code (and no longer updates with new releases). Fixes are welcome upstream: https://github.com/xribene/Euterpe.
