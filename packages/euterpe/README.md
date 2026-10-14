# Euterpe

A browser framework for real-time interactive music agents. A person plays (laptop keyboard, MIDI keyboard or microphone) and your agent answers, in the browser, with no server. You write the agent: its hooks in JavaScript and a few YAML files. Euterpe does the rest: MIDI and audio input, the clock and quantization, samplers and audio output, and the UI (score, piano roll, keyboard, Settings widgets).

[Website](https://euterpeframework.org) · [Demos](https://euterpeframework.org/guide/demos) · [Paper (JAES 2023)](https://doi.org/10.17743/jaes.2022.0117) · [Source](https://github.com/xribene/Euterpe)

## Start a project

```bash
npm create euterpe@latest my-agent
cd my-agent
npm install
npm run dev
```

Templates: `empty`, `copycat`, `call-response` and `synth` (MIDI in, audio out). Each project comes with an `AGENTS.md` that documents the whole API, for you and for coding agents.

## An agent

```js
// agent/hooks.js
import {defineAgent} from 'euterpe/agent';

let sounding = null; // the note the agent is playing

export default defineAgent({
    // every 16th note (config.yaml: gridBased): play the user's note an octave up, two ticks later
    processClockEvent({userQuantizedNotes}, ctx) {
        const {NOTE_ON, NOTE_HOLD} = ctx.types.noteType;
        const onset = userQuantizedNotes.find((note) => note.type === NOTE_ON);
        const held = userQuantizedNotes.some((note) => note.type === NOTE_HOLD);
        const notes = [];
        if (sounding !== null && (onset || !held)) {
            notes.push(ctx.noteOff(sounding, {tick: 2}));
            sounding = null;
        }
        if (onset) {
            sounding = onset.midi + 12;
            notes.push(ctx.noteOn(sounding, {tick: 2, velocity: onset.velocity}));
        }
        return notes;
    },
});
```

```js
// vite.config.js
import {defineConfig} from 'vite';
import euterpe from 'euterpe/vite';

export default defineConfig({plugins: [euterpe()]});
```

The agent runs in a Web Worker, so models (TF.js, onnxruntime-web, your own WebGPU or WASM code) never block the UI. Its hooks:

| Hook | When it runs |
|---|---|
| `loadAlgorithm(ctx)` | once, at startup |
| `processClockEvent(clock, ctx)` | every tick of the grid |
| `processNoteEvent(note, ctx)` | every user note, in free time |
| `processAudioBuffer(frame, ctx)` | every microphone frame |
| `renderAudio(frames, ctx)` | audio output |
| `updateParameter(change, ctx)` | a Settings widget changed |

`agent/config.yaml`, `widgets.yaml` and `players.yaml` choose the interaction mode, the clock, the UI and the instruments. They're validated against the JSON schemas in `schema/` at dev and build time.

## What's in the package

| Export / command | What it is |
|---|---|
| `euterpe/vite` | The Vite plugin. It loads the agent and its YAML, serves and copies the instrument samples, and sets the cross-origin isolation headers. |
| `euterpe/agent` | `defineAgent`, `NoteEvent`, small helpers and the type enums |
| `npx euterpe smoke [--build]` | A headless-browser check: the page is isolated, the agent is ready, the clock ticks, the agent answers a phrase, and there are no errors |
| `npx euterpe eject` | Copies Euterpe into the project, to change it freely |

TypeScript types ship in `types/`, including the YAML config types (generated from the schemas).

## Deploying

A built project (`npm run build`, then `dist/`) is a static site. It must be served with these headers:

```text
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

Euterpe uses SharedArrayBuffer between the page, the agent worker and the audio thread. The templates include `netlify.toml` and `vercel.json` with these headers.

## Requirements

Node 18+, Vite 5. Chrome (or another Chromium browser) is recommended. `playwright-core` is optional, and only needed for `euterpe smoke`.

## Citation

If you use Euterpe in your research, please cite:

> Y. Zang\*, C. Benetatos\*, and Z. Duan, "Euterpe: A Web Framework for Interactive Music Systems," *Journal of the Audio Engineering Society*, vol. 71, no. 11, pp. 738–752, 2023. doi:[10.17743/jaes.2022.0117](https://doi.org/10.17743/jaes.2022.0117)
>
> \* Equal contribution.

```bibtex
@article{zang2023euterpe,
  author  = {Zang, Yongyi and Benetatos, Christodoulos and Duan, Zhiyao},
  title   = {Euterpe: A Web Framework for Interactive Music Systems},
  journal = {Journal of the Audio Engineering Society},
  volume  = {71},
  number  = {11},
  pages   = {738--752},
  year    = {2023},
  doi     = {10.17743/jaes.2022.0117}
}
```

## Licence

MIT, © Christodoulos Benetatos and Yongyi Zang.

