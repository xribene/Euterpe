# Known issues and inconveniences

Found while packaging Euterpe (branch `npm-package`). Newest first within each section. Status: **open**, **fixed** (commit), **workaround**.

## Framework (packages/euterpe)

| # | Issue | Evidence | Suggested fix | Status |
|---|---|---|---|---|
| F19 | Every build copies all 17 MB of instrument samples (piano, drums, upright bass, click), whatever the agent's `players.yaml` uses; a built site is 27 MB, most of it samples. | `vite build` of each template: 27 MB `dist/` | Copy only the instruments `players.yaml` lists (the plugin reads it already); later a CDN (P1) | open |
| F13 | `NoteEvent.createdAt.seconds` holds the main thread's `performance.now()` in **milliseconds**, a clock whose origin differs from the worker's `performance.now()`. Agents can only use differences. | `Keyboard.vue:234`, `Euterpe.vue:467,1315`; CallAndResponse divides by 1000 | Rename or convert to seconds on a shared clock (with the audio-clock work), behind a deprecation | open |
| F14 | Sliders and switches reach the agent by position (`SLIDER_{index+1}`), dropdowns and buttons by their YAML `id`; a slider's `id` in YAML is ignored. | `Euterpe.vue` watchers `computedSliders`, `computedSwitches`, `computedDropdowns`, `buttonAction` | Send every widget by id; `ctx.params` hides it today | workaround (`ctx.params`) |
| F15 | Agents duplicated the YAML widget defaults in code, and they drifted: GridyCopycat starts with pitch shift 0 but maps the slider as `value - 24`, so the first touch of the slider jumps two octaves. | `examples/GridyCopycat/initAgent_hook.js` | `ctx.params` starts from the YAML values (templates fixed; examples/ unchanged) | workaround |
| F16 | The UI ignores an agent's `STATUS: ERROR`; only its `TEXT` reaches the loading screen, and the start button never appears. | `Euterpe.vue` `agentCallback` | Show the error on the loading screen with a retry hint | open |
| F17 | The thesis lists `loadConfig` and `processVariableUpdate` hooks; the code has no `loadConfig` hook (the runtime does it) and calls the other `updateParameter`. | `THESIS/chapters/05-euterpe.tex:146-157` | Align the docs and the defense slides with the code names | open |
| F18 | The console is noisy: every widget change logs twice ("param index ... value"), plus debug lines ("AAAAAAAA", "TONE TONE TONE", "added sub", "in displayPlayBtn"). Real warnings drown. | any run with `--logs` | Remove debug logs; keep one `[euterpe]` prefix for real messages | open |
| F1 | The score's "Agent's output is not monophonic (2)" error fires for any agent note-off that doesn't match the last note-on, not only for polyphony. | `store/modules/note-buffers.js:207`; BachDuet triggers it with a stray note-off (B1) | Say what happened ("note-off for 60, which the score never saw start"); log once, not per tick | open |
| F2 | There is no setting for the agent's output polyphony. `noteModeSettings.gridBased.polyphony` has only `input`. The score assumes a monophonic agent ("ScoreUI only supports monophonic", `Euterpe.vue:882`) and shows only the first note of a chord. | ReaLchords/GAPT play chords | Add `polyphony.output` to the config schema and make the score draw chords or say it can't | open |
| F3 | Agent notes with `playAfter.tick == 0` are played at once and skip the score's tracker (`updateLastAgentNote`), so the score never sees them and a later note-off for them trips F1. | `Euterpe.vue:964-970` | Route both paths through one function that updates the score | open |
| F4 | Agent notes whose tick has already passed are dropped silently (`popAgentNotesToBePlayedAt`, `tick < currentGlobalTick`). Neither the agent nor the developer learns that inference was too slow. | `note-buffers.js:169` | Warned in the console (`[euterpe] an agent note ... was dropped`), with the slow-hook warning | fixed (warned) |
| F5 | Euterpe makes its own `AudioContext` for the microphone while Tone.js plays through a second one (`Tone.setContext(vm.audioContext)` is commented out: "this cause huge latency"). Two audio clocks. | `Euterpe.vue:279-283` | Investigate together with the audio-clock redesign (PACKAGING_PLAN, Clock) | open |
| F6 | `Tone.context.lookAhead = 0` behaves differently across Tone versions. In 14.7.77 the Tone timer stays at 20 Hz; in 14.9 setting lookAhead to 0 also sets the timer to 10 ms. The samplers schedule straight on the Web Audio clock and are unaffected, but the FM `synth` instrument (`Tone.PolySynth`) queues future notes on that timer, so they can sound up to ~50 ms late on 14.7.77. | Fresh `npm install` got 14.9.17: Tone's timer worker posted 74/s against 18/s | Tone and webmidi pinned to the bachduet.com versions; test Tone 14.9 separately (it may make the synth tighter) | workaround (40a26f3) |
| F7 | The "dirty hack to deal with tone.js weird behavior": a note-on in the same tick as a note-off of the same pitch is delayed by `delayForNoteOn`. | `Euterpe.vue:950-962` | Understand it and document or remove it | open |
| F8 | `loadAlgorithm` is not awaited, and every agent must post the SUCCESS status message itself; if it forgets, the UI waits forever. | `worker/agentWorker.js` `initAgent` | `defineAgent`: await `loadAlgorithm`, post SUCCESS (or the error) for the agent (step 2) | open |
| F9 | The main bundle is 3.9 MB (1.2 MB gzipped). vue-material, three.js, chart.js and tweakpane all load up front. | `vite build` of the empty template | Load widgets on demand; check whether three.js is still used | open |
| F10 | `vue-material` is an unmaintained 2019 beta with a postinstall nag (opencollective). `npm install` prints an install-scripts warning for it. | npm 11 output in a fresh project | Replace the three components it provides (MdButton, MdIcon, MdField) | open |
| F11 | `vue-js-toggle-button` declares no licence in its package.json. | licence scan | Check its repo or replace it (it's one small component) | open |
| F12 | Vite's dev server reloads the page the first time an agent loads a dependency it hadn't pre-bundled (onnxruntime-web when the transformer was picked), which broke the first BachDuet smoke run. | step 0 smoke run | The plugin crawls `agent/**` at startup | fixed (9748ae4) |

## BachDuet (apps/bachduet)

| # | Issue | Evidence | Suggested fix | Status |
|---|---|---|---|---|
| B1 | On the first tick BachDuet sends a note-off for a note it never played (e.g. MIDI 60 when the user starts on 72). `self.lastSoundedNote ??= self.lastBachDuetNote` takes turn-taking's octave-below seed as the sounding note, and the first (muted) choice turns it off. Harmless to the audio (the sampler ignores it), but it trips F1 on every run. | `tools/score-mono/probe.mjs`: first agent message `off:60@+1`, then the error | `processClockEvent_hook.js`: `self.lastSoundedNote ??= self.restNote` (one line; not applied here because the other session is editing these files) | open |

## Templates and developer experience

| # | Issue | Evidence | Suggested fix | Status |
|---|---|---|---|---|
| D1 | The empty agent's `config.yaml` has both `gridBased` and `eventBased` off, so its hooks never receive notes or clock events and the template looks dead. | smoke run: the agent worker sent nothing while playing | Empty template: grid mode on, hooks that do nothing but are called | fixed (step 2) |
| D2 | Space toggles the clock (when no dialog is open). With `autoStart: true` the clock is already running after the entry button, so a test that presses Space stops it. My first smoke script did exactly that. | `Euterpe.vue:252`, `entryProgram` | `window.__euterpe.startClock()` / `stopClock()` / `clockRunning` | fixed |
| D7 | A runtime that silently falls back to no-op hooks hides mistakes: my first `defineAgent` runtime unwrapped the hooks module one level too little, and the empty template still "worked" (ready, no errors) because every hook was a default. Only an agent that must answer caught it. | step 2 | Smoke checks of templates use `--expect-answer`; the runtime warns when agent/hooks.js defines no hooks | fixed |
| D3 | Browser tests reach into Vue internals (`__vue__`, `$children`, `showSettingsModal`, `#dropdown2`). | `apps/bachduet/tools/turn-taking/smoke_turntaking.mjs` | `window.__euterpe` and `data-testid`s; `tools/smoke/check.mjs` uses them (the BachDuet turn-taking smoke still uses the old way) | fixed for new tests |
| D4 | The turn-taking smoke test takes ~3.4 min per model (~30 min for all 9) and prints results only at the end, so a crash loses the whole run (it did once). | step 0 | Write each model's result as soon as it finishes | open |
| D5 | Installing with npm prints install-script warnings (esbuild, vue-material); pnpm 12 refuses to install without `allowBuilds` in `pnpm-workspace.yaml`. | fresh installs | Templates ship the pnpm setting; F10 removes one of the two | workaround |
| D8 | Changes to Euterpe's Vite plugin (`packages/euterpe/vite/`) need a dev server restart: Vite loads plugins once. A dev server left running serves stale virtual modules (the page fails with "does not provide an export named ..."). Only affects people working on Euterpe itself. | step 2, item 2 | Restart; nothing to fix | note |
| D9 | `npm create` (npx) caches create-euterpe by name and version: republishing the same version (local rehearsals) scaffolds from the stale copy. Users never republish a version, so only the rehearsal is affected. | rehearsal scaffolded templates without `smoke` | rehearse.sh uses its own empty npm cache | fixed (rehearsal) |
| D6 | The root README describes the old single-app layout (paths under `public/`, install steps). | `README.md` | Rewrite for the package (step 5) | open |

## Packaging and repo

| # | Issue | Evidence | Suggested fix | Status |
|---|---|---|---|---|
| P1 | The licence and origin of the 17 MB of instrument samples are unknown. The file names match the tonejs-instruments set. They ship inside the `euterpe` tarball for now. | `packages/euterpe/assets/samples` | Confirm the source and licence before publishing; otherwise host them elsewhere (CDN) with attribution | open, blocks publish |
| P2 | The copyright line names Yongyi Zang, whose agreement to MIT is still needed. | `LICENSE` | Ask Yongyi before publishing | open, blocks publish |
| P3 | The same dev fixes (permissions / play button / MIDI init) exist on `dev` and on `primed-anticipation` under different hashes, so merging those branches later will conflict on `Euterpe.vue`. | `git cherry-pick` of 811a40e conflicted, though the content was already there | Retire `dev` once `npm-package` lands | open |
| P4 | Netlify builds bachduet.com from the repo root of the `bachDuet` branch. On the new layout the site's base directory is `apps/bachduet` (its `netlify.toml` pins Node 21.1.0). | `apps/bachduet/netlify.toml` | Change the Netlify settings only when switching the site over (ask first) | open |
