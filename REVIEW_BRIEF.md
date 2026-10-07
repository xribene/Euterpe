# Review brief: Euterpe as an npm package (branch `npm-package`)

You are reviewing work by another coding agent. Read this, then the code. Report findings; do not change files.

## What Euterpe is

A browser framework for real-time interactive music agents: a human plays (laptop keyboard, MIDI keyboard, microphone) and an agent answers in the browser. The developer writes only the agent's hooks and YAML config; Euterpe does input, clock, quantization, the worker protocol, samplers and the UI (Vue 2.7, Vuex 3, Vite 5, Tone.js 14.7.77, VexFlow, ringbuf.js with SharedArrayBuffer, so the page must be cross-origin isolated).

Before this branch, Euterpe was an app you forked: the UI imported the agent from a fixed `src/agent/` folder, and each agent lived on its own branch with a copied 295-line worker boilerplate.

## What this branch does (commits `717e05e..HEAD`)

`717e05e` is the starting point (primed-anticipation, BachDuet as one app). The branch turns the repo into a pnpm workspace:

```text
packages/euterpe/         the framework, published as `euterpe`
  src/                    the Vue UI (moved from src/), store, utils
  src/worker/             agentWorker.js (worker runtime), context.js (ctx), clock.js, recorder worklet
  src/agent.js            `euterpe/agent`: defineAgent, NoteEvent, helpers (runs in the worker)
  src/utils/handle.js     window.__euterpe (test/script handle)
  vite/                   `euterpe/vite`: the Vite plugin (index.js) and YAML validation (validate.js)
  cli/                    `euterpe` command: smoke (headless browser check), eject; serve.js (static server)
  types/                  .d.ts for the public API; config.d.ts is generated from schema/
  schema/                 JSON Schemas of config.yaml, widgets.yaml, players.yaml
packages/create-euterpe/  `npm create euterpe@latest`: copies a template (index.js; templates bundled at prepack)
templates/                empty, copycat, call-response (+ _shared files synced by tools/sync-templates.mjs)
apps/bachduet/            BachDuet as an ordinary project on the package (agent code written the original way)
apps/realchords/          ReaLchords/GAPT chord agents on the package (defineAgent), int8 ONNX weights
tools/                    acceptance/rehearse.sh (end-to-end against a local registry), smoke/, sync-templates
examples/                 the old agent examples, NOT converted yet (out of scope)
KNOWN_ISSUES.md           known problems, with status: do not re-report these
```

Key design points:
- The UI never imports agent code directly. The plugin serves two virtual modules: `virtual:euterpe-agent` (the project's `agent/hooks.js`, imported by the worker runtime) and `virtual:euterpe-config` (the merged YAML, intro text, samples URL, config warnings). Worker bundles get the virtual-module plugin through `worker.plugins`.
- The package ships readable source (not prebuilt) and is excluded from Vite's dependency pre-bundling; its own dependencies and the agent's are pre-bundled explicitly so the dev server doesn't reload mid-session.
- Hooks: `defineAgent({loadAlgorithm, processClockEvent, processNoteEvent, processAudioBuffer, updateParameter})`; each gets `(input, ctx)`. Agents written the original way (named exports, reading `self.*` globals, posting their own SUCCESS status) must keep working unchanged: BachDuet does.
- A hook returns an array of notes or `{notes, text, label, vector, key, ...}`; the runtime converts that to the original message protocol (numeric `messageType` keys) and checks the notes.

## Where to look hardest

1. `packages/euterpe/src/worker/agentWorker.js`, `context.js`: the two code paths (defineAgent vs original style), ordering of async clock/note events, error handling (a hook error must not stall the queue), readiness reporting, `ctx.params` (widgets by YAML id), `ctx.now()` (page clock), `toMessage`/`checkNotes`. A previous bug here made every hook a silent no-op while the page still looked fine: look for anything else that can fail silently.
2. `packages/euterpe/vite/index.js`, `validate.js`: virtual modules in dev and in the worker build, `base` other than `/`, Windows paths (`normalizePath`), the samples middleware (path traversal), HMR of YAML, `optimizeDeps` settings, schema errors vs warnings (false positives on valid configs are bad).
3. `packages/create-euterpe/index.js` and `scripts/bundle-templates.mjs`: argument parsing, directory handling (non-empty, relative/absolute, names with spaces), package name sanitising, what gets copied.
4. `packages/euterpe/cli/index.js` (`eject`: copying the package into the project, rewriting package.json), `smoke.js`, `serve.js` (path traversal, content types).
5. `packages/euterpe/src/views/Euterpe.vue` and `src/store/modules/note-buffers.js` changes (see `.review/framework-changes.diff`): one shared AudioContext with Tone.js (created in `created()` before the samplers), widget watchers sending by id, late-note and slow-tick warnings, score warnings, `window.__euterpe` install.
6. `packages/euterpe/types/*.d.ts` vs what the runtime actually does (e.g. ctx fields, HookOutput keys, NoteEvent fields), and `templates/_shared/AGENTS.md` vs the code: docs that are wrong are bugs.
7. The templates' `agent/hooks.js` and `apps/realchords/agent/hooks.js`: musical logic errors (stuck notes, wrong note-offs, timing units).

Out of scope: `apps/bachduet/agent/*` internals (BachDuet's own model code; only `hooks.js` and imports were touched), `examples/`, vendored `src/worker/ringbuf-classic.js`, generated `types/config.d.ts`, the Vue 2 UI code that the branch only moved, anything listed in `KNOWN_ISSUES.md`.

## Files

- Focused diff of the framework source that changed (renames detected): `.review/framework-changes.diff`
- Everything else listed above is new in this branch: read the files directly.
- Full history: `git log --oneline 717e05e..HEAD` (commit messages explain each step and what was checked).

## How it was checked (for context; you don't need to run these)

```bash
pnpm install
pnpm check-templates                      # templates identical to templates/_shared
(cd templates/copycat && pnpm typecheck && pnpm smoke)   # headless Chrome: isolated, ready, answers a phrase
tools/acceptance/rehearse.sh              # local npm registry: npm create -> install -> smoke (dev, build) -> eject
node apps/realchords/tools/parity_web.mjs --quant f16w   # chords vs PyTorch (needs local logits)
apps/bachduet/tools/replay-parity/        # seeded note-for-note replay vs the pre-package build
```

## What to report

A list of findings, most severe first. For each: file:line, what is wrong, a concrete scenario where it breaks (inputs/state → wrong result), and a suggested fix. Mark how sure you are (confirmed by reading the code path end to end, or plausible). Skip style nits unless they hide a bug. If you find nothing serious in an area, say so briefly, so we know it was looked at.
