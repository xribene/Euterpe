# Known issues and inconveniences

Found while packaging Euterpe (branch `npm-package`). Newest first within each section. Status: **open**, **fixed** (commit), **workaround**.

## Framework (packages/euterpe)

| # | Issue | Evidence | Suggested fix | Status |
|---|---|---|---|---|
| F28 | There was no way to type text (e.g. a prompt) into an agent: widgets only send numbers through the parameter ring buffer. | MRT2 style prompts | `settingsModal.textFields` (up to 4; `intro: true` also shows one on the start screen): sent as a message on Enter or blur, `ctx.params.text[id]`, `updateParameter({kind: 'text'})`; key presses in a field don't play notes. Old-style agents (no defineAgent) don't get text changes | fixed |
| F25 | The input framing emitted each frame before writing its last sample, so the last sample of every frame was stale. | old `_readFromQueue` | New framer (`worker/audioIn.js`), checked sample by sample on a ramp | fixed |
| F26 | A mono microphone would have crashed the recorder worklet (`interleave` requires two channels; Chrome's fake device happens to be stereo), and any render quantum other than 128 too. | `recorder-worklet.js` | The recorder node is set to 2 channels (mono copied to both) and interleaves any block size | fixed |
| F27 | The worker read at most one hop of input every 10 ms: with a small hop (e.g. 256) that is slower than the microphone, and the input ring buffer overflowed. | old `initAudio` (`staging = hopSize`) | Each read drains the ring buffer | fixed |
| F23 | The microphone is opened with `getUserMedia({audio: true})`, so the browser's speech processing is on: echo cancellation, noise suppression and automatic gain control. For music (and for audio models) that distorts the input: AGC pumps, NS removes sustained tones. | `Euterpe.vue` (getUserMedia) | Off by default; `audioModeSettings.echoCancellation` / `noiseSuppression` / `autoGainControl` turn them on (checked on the track: all false) | fixed |
| F24 | Audio frames reach `processAudioBuffer` without a timestamp, so an agent can't relate an input frame to clock ticks or to its own output (needed to align audio in/out models with the music). | `worker/agentWorker.js` `_readFromQueue` | Each frame carries `start` (samples since the microphone started), `time` (page clock, like ctx.now()) and `sampleRate`; measured: frames reach the agent 13 ms (median) after their last sample was captured | fixed |
| F21 | In event mode the user's notes reached the agent only while the clock ran, so a free-time agent (the synth) was silent until the user pressed play, although it doesn't use the clock. | `processUserNoteEvent` | Agents without gridBased get every note; grid agents (and mixed ones like call-response) still only while the clock runs | fixed |
| F22 | The start button's fade-in animated `display` and `visibility` (not only opacity): during the fade the button left the layout and clicks fell through to its container, so early clicks were lost (in headless Chrome the animation stalled and the button never responded; the old BachDuet smoke test clicked it 5 times in a loop). | `css/main.css` `@keyframes fade-in` | Opacity only | fixed |
| F20 | The agent could not play audio: the thesis (05-euterpe.tex, Audio Scheduling, Audio Recorder and Player) describes an Audio Player fed by a second ring buffer, but it never existed on any branch; `messageType.AUDIO_BUFFER` was defined and unused. | `git log --all -S` | Implemented: `interactionMode.audioOut`, `audioOutSettings`, `renderAudio` hook, `ctx.audioOut`, `{audio}` return key, player worklet into the agent's mixer bus, underrun warning | fixed |
| F19 | Every build copies all 17 MB of instrument samples (piano, drums, upright bass, click), whatever the agent's `players.yaml` uses; a built site is 27 MB, most of it samples. | `vite build` of each template: 27 MB `dist/` | The build copies only the instruments players.yaml lists (copycat: 27 → 25 MB). The piano alone is 15 MB (85 samples): Tone.Sampler pitch-shifts between samples, so every 3rd semitone (~5 MB) may sound the same; to try by ear | partly fixed |
| F13 | `NoteEvent.createdAt.seconds` holds the main thread's `performance.now()` in **milliseconds**, a clock whose origin differs from the worker's `performance.now()`. Agents can only use differences. | `Keyboard.vue:234`, `Euterpe.vue:467,1315`; CallAndResponse divides by 1000 | createdAt.seconds is now seconds (page clock); ctx.now() gives the same clock in the worker; call-response template updated (examples/CallAndResponse still divides by 1000) | fixed |
| F14 | Sliders and switches reach the agent by position (`SLIDER_{index+1}`), dropdowns and buttons by their YAML `id`; a slider's `id` in YAML is ignored. | `Euterpe.vue` watchers `computedSliders`, `computedSwitches`, `computedDropdowns`, `buttonAction` | Sliders and switches are sent by YAML id (position only when a widget has no id); every existing config had id = position; duplicate ids are a validation error | fixed |
| F15 | Agents duplicated the YAML widget defaults in code, and they drifted: GridyCopycat starts with pitch shift 0 but maps the slider as `value - 24`, so the first touch of the slider jumps two octaves. | `examples/GridyCopycat/initAgent_hook.js` | `ctx.params` starts from the YAML values (templates fixed; examples/ unchanged) | workaround |
| F16 | The UI ignores an agent's `STATUS: ERROR`; only its `TEXT` reaches the loading screen, and the start button never appears. | `Euterpe.vue` `agentCallback` | The loading screen shows the error in red, plus a console error | fixed |
| F17 | The thesis lists `loadConfig` and `processVariableUpdate` hooks; the code has no `loadConfig` hook (the runtime does it) and calls the other `updateParameter`. | `THESIS/chapters/05-euterpe.tex:146-157` | Align the docs and the defense slides with the code names | open |
| F18 | The console is noisy: every widget change logs twice ("param index ... value"), plus debug lines ("AAAAAAAA", "TONE TONE TONE", "added sub", "in displayPlayBtn"). Real warnings drown. | any run with `--logs` | Framework debug logs are console.debug (hidden unless Verbose); real messages start with [euterpe] | fixed |
| F1 | The score's "Agent's output is not monophonic (2)" error fires for any agent note-off that doesn't match the last note-on, not only for polyphony. | `store/modules/note-buffers.js:207`; BachDuet triggers it with a stray note-off (B1) | Now one warning, once: "the agent turned off note 60, which the score did not see start" | fixed |
| F2 | There is no setting for the agent's output polyphony. `noteModeSettings.gridBased.polyphony` has only `input`. The score assumes a monophonic agent ("ScoreUI only supports monophonic", `Euterpe.vue:882`) and shows only the first note of a chord. | ReaLchords/GAPT play chords | The score supports one agent voice (Christos, 2026-10-06); polyphonic agents use the piano roll | by design |
| F3 | Agent notes with `playAfter.tick == 0` are played at once and skip the score's tracker (`updateLastAgentNote`), so the score never sees them and a later note-off for them trips F1. | `Euterpe.vue:964-970` | By design the score shows grid timing only: notes played at once (free time) are skipped, and their note-offs no longer trigger the unmatched-note-off warning | fixed |
| F4 | Agent notes whose tick has already passed are dropped silently (`popAgentNotesToBePlayedAt`, `tick < currentGlobalTick`). Neither the agent nor the developer learns that inference was too slow. | `note-buffers.js:169` | Warned in the console (`[euterpe] an agent note ... was dropped`), with the slow-hook warning | fixed (warned) |
| F5 | Euterpe makes its own `AudioContext` for the microphone while Tone.js plays through a second one (`Tone.setContext(vm.audioContext)` is commented out: "this cause huge latency"). Two audio clocks. | `Euterpe.vue:279-283` | One native AudioContext, given to Tone.js before the samplers exist, lookAhead 0 (the old "huge latency" was most likely Tone's default lookAhead of 0.1 s on a shared context). Measured note-on → sound: median 46.9 ms vs 45.5 ms before (10 runs each, ranges overlap; the method has ~3 ms resolution); microphone frames reach processAudioBuffer | fixed |
| F6 | `Tone.context.lookAhead = 0` behaves differently across Tone versions. In 14.7.77 the Tone timer stays at 20 Hz; in 14.9 setting lookAhead to 0 also sets the timer to 10 ms. The samplers schedule straight on the Web Audio clock and are unaffected, but the FM `synth` instrument (`Tone.PolySynth`) queues future notes on that timer, so they can sound up to ~50 ms late on 14.7.77. | Fresh `npm install` got 14.9.17: Tone's timer worker posted 74/s against 18/s | Tone and webmidi pinned to the bachduet.com versions; test Tone 14.9 separately (it may make the synth tighter) | workaround (40a26f3) |
| F7 | The "dirty hack to deal with tone.js weird behavior": a note-on in the same tick as a note-off of the same pitch is delayed by `delayForNoteOn`. | `Euterpe.vue:950-962` | Understand it and document or remove it | open |
| F8 | `loadAlgorithm` is not awaited, and every agent must post the SUCCESS status message itself; if it forgets, the UI waits forever. | `worker/agentWorker.js` `initAgent` | `defineAgent`: await `loadAlgorithm`, post SUCCESS (or the error) for the agent (step 2) | open |
| F9 | The main bundle is 3.9 MB (1.2 MB gzipped). vue-material, three.js, chart.js and tweakpane all load up front. | `vite build` of the empty template | Load widgets on demand; check whether three.js is still used | open |
| F10 | `vue-material` is an unmaintained 2019 beta with a postinstall nag (opencollective). `npm install` prints an install-scripts warning for it. | npm 11 output in a fresh project | Replace the three components it provides (MdButton, MdIcon, MdField) | open |
| F11 | `vue-js-toggle-button` declares no licence in its package.json. | licence scan | Its package ships an MIT LICENSE file; only package.json lacks the field | resolved |
| F12 | Vite's dev server reloads the page the first time an agent loads a dependency it hadn't pre-bundled (onnxruntime-web when the transformer was picked), which broke the first BachDuet smoke run. | step 0 smoke run | The plugin crawls `agent/**` at startup | fixed (9748ae4) |

## BachDuet (apps/bachduet)

| # | Issue | Evidence | Suggested fix | Status |
|---|---|---|---|---|
| B2 | The same BachDuet code plays different notes in dev and in a production build (same seed, same melody at the same ticks): identical for 74 ticks, then 14 of 128 differ. It happens before packaging too (717e05e), so it isn't a packaging change. Unknown cause (TF.js in a pre-bundled dev dependency vs the built bundle, or a different number of Math.random calls). It matters for reproducible experiments. | `tools/replay-parity` | Low priority: it only matters if someone expects identical notes from a dev server and a production build of the same seeded run; no user does. Both use the same primed starting state, so it is not the hidden-state difference (B3) | note |
| B3 | primed-anticipation's BachDuet (and so the package's) plays differently from bachduet.com: 84 of 128 ticks identical with turn-taking, anticipation, imitation and avoid rests at 0. Cause: the starting state and the default temperature. bachduet.com starts from random LSTM states and samples at Temperature 25; the new one starts from the state primed for the starting key at Temperature 1. From the same (zero) starting state at Temperature 1 the two play identically (128/128), so neither the TF.js version (old tf.min.js vs 4.22 WASM) nor the new decoder changes a choice. | `tools/replay-parity` (temporary zero-state patches, not committed) | Nothing to fix; for the slides: "same network and decoding as bachduet.com; new starting states and defaults" | explained |
| B5 | Live canvas: when "Draw & Listen" is picked on the canvas, the model loads at the next tick, so the first ~2 ticks use the rules (the status line says "onnx loading"). With `model: onnx` in widgets.yaml it loads at startup. | `tools/live-canvas/smoke.mjs --model=onnx`: modes rules 2, onnx 65 | Load on the switch (needs a message to the worker; the SAB is only read at ticks) | open |
| B4 | Live canvas: `pnpm dev:bachduet -- --port N` does not change the port (the `--` reaches vite as an argument; it stays on 5173). | dev log | Run `npx vite --port N` in apps/bachduet | workaround |
| B1 | On the first tick BachDuet sends a note-off for a note it never played (e.g. MIDI 60 when the user starts on 72). `self.lastSoundedNote ??= self.lastBachDuetNote` takes turn-taking's octave-below seed as the sounding note, and the first (muted) choice turns it off. Harmless to the audio (the sampler ignores it), but it trips F1 on every run. | `tools/score-mono/probe.mjs`: first agent message `off:60@+1`, then the error | `processClockEvent_hook.js`: `self.lastSoundedNote ??= self.restNote` (one line; not applied here because the other session is editing these files) | open |

## Magenta RT 2 (apps/mrt2)

| # | Issue | Evidence | Suggested fix | Status |
|---|---|---|---|---|
| M5 | Notes and prompts are heard ~0.45-0.65 s late: up to `audioOutSettings.latency` (0.25 s) plus one 0.4 s decode chunk is queued ahead. | `agent/live.js` pacing | Decode smaller chunks (if the streaming decoder allows), or a lower latency if the machine has headroom (1.6x real time here) | open |
| M4 | `agent/live.js` uses the engine's internals (`_genFrame`, `_streamDecode`, `S.encoder`, `TEMPORAL.setSource`, `lastTokens`): the engine has no API for per-frame notes. | `agent/live.js` | Pinned to one revision by `scripts/fetch-engine.mjs`; recheck when updating it | note |
| M3 | The engine downloads its weights (~650 MB, ~930 MB more for `?precision=fp32`) from Hugging Face on the first load per browser profile (Cache Storage), not from `public/models`; Playwright's fresh profiles re-download on every run (~30-45 s). | `live.mjs`, `spectrum.mjs` runs | Serve the files locally for tests | note |
| M2 | The output sounds dull: with q4 weights energy is ~40 dB down at 8-10 kHz and ~50 dB above 16 kHz (relative to the total). Not Euterpe's resampling (decoded and played spectra match within ~2 dB). Causes: SpectroStream at 12 of 64 RVQ levels (~3 kbit/s, by design), the 4-bit weights (fp32: +4-8 dB at 8-14 kHz, still real time here, follows chords better), and sampling from all 1024 tokens (the PyTorch code uses top-k 40, temperature 1.3). | `spectrum.mjs` | `?precision=fp32` as the default if it sounds better; add top-k to the engine's sampler | open |
| M1 | The engine (`magenta-rt.mjs`, magenta-community/magenta-rt-stack Space) has no stated licence, so it is not committed: `scripts/fetch-engine.mjs` downloads and patches a pinned revision into `agent/vendor/` (gitignored). | Space metadata: no licence | Ask the authors for a licence before shipping anything built on it | open, blocks shipping |

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
| D10 | Inside the repo, `create-euterpe` preferred the `templates/` folder left in its package by the last `npm pack` (a stale copy) over the repo's templates, so a project scaffolded during development got old files. | the FolkDuet project got an old jsconfig.json and package.json | `postpack` deletes the bundled copy | fixed |
| D6 | The root README describes the old single-app layout (paths under `public/`, install steps). | `README.md` | Rewrite for the package (step 5) | open |

## Packaging and repo

| # | Issue | Evidence | Suggested fix | Status |
|---|---|---|---|---|
| P1 | The licence and origin of the 17 MB of instrument samples are unknown. The file names match the tonejs-instruments set. They ship inside the `euterpe` tarball for now. | `packages/euterpe/assets/samples` | Confirm the source and licence before publishing; otherwise host them elsewhere (CDN) with attribution | open, blocks publish |
| P2 | The copyright line names Yongyi Zang, whose agreement to MIT is still needed. | `LICENSE` | Ask Yongyi before publishing | open, blocks publish |
| P3 | The same dev fixes (permissions / play button / MIDI init) exist on `dev` and on `primed-anticipation` under different hashes, so merging those branches later will conflict on `Euterpe.vue`. | `git cherry-pick` of 811a40e conflicted, though the content was already there | Retire `dev` once `npm-package` lands | open |
| P4 | Netlify builds bachduet.com from the repo root of the `bachDuet` branch. On the new layout the site's base directory is `apps/bachduet` (its `netlify.toml` pins Node 21.1.0). | `apps/bachduet/netlify.toml` | Change the Netlify settings only when switching the site over (ask first) | open |

## Review (Codex Astra via pi, 2026-10-06)

`REVIEW_ASTRA_2026-10-06.md`: 11 findings on `717e05e..1725bc9`, all confirmed against the code and fixed:

| # | Finding | Fix | Checked |
|---|---|---|---|
| R1 | Static servers (`cli/serve.js`, the samples middleware) allowed sibling-directory traversal (`startsWith` without a boundary) | `path.relative` containment | `/%2e%2e%2fdist-private/secret.txt` → 403 |
| R2 | `updateParameter` / `processAudioBuffer` could run while `loadAlgorithm` was still loading | widget changes go to `ctx.params` at once and to the hook after loading; audio frames dropped until ready | agent whose `updateParameter` throws before its model exists: no error, 2 changes replayed |
| R3 | A config without `audioModeSettings` (schema-valid) crashed the worker's setup silently; the page waited forever | defaults (1024 / 1024); any setup error reaches the loading screen | config without the key: ready, no errors |
| R4 | Copycat: changing Delay while a note sounded could release it before it started | the note-off uses its note-on's delay | note-on tick 8, Delay → 1, note-off still tick 8 |
| R5 | ReaLchords: switching models released the chord before its queued notes started (stuck chord) | old model stopped at once, its chord released on the next tick, after its queued notes | rapid switches: only the current chord sounding at the end |
| R6 | ReaLchords: an older model load could replace a newer selection | selection counter: only the latest installs | ReaLchords → GAPT in 150 ms: GAPT active |
| R7 | Call-response treated a held note as silence | answers only with no note held | 3 s held: no answer; answer after release |
| R8 | `euterpe smoke --build` ignored a non-root `base` | the static server mounts the build at `base` | served at `/music/` |
| R9 | A malformed URL (`/%`) crashed the static server | 400; stream errors handled | `/%` → 400, server still up |
| R10 | Types promised `userNotes` / `userQuantizedNotes` arrays that were absent when disabled | always arrays for defineAgent hooks (empty when disabled) | `quantizedEvents: false`: hook reads `.length`, 0 |
| R11 | `create-euterpe`: typing a template name at the prompt silently picked `empty` | empty answer, number and name handled; anything else rejected | `copycat` → copycat, `9` / `violin` → error |

## Review of the audio output (Codex Astra via pi, 2026-10-06)

`REVIEW_ASTRA_AUDIO_OUT_2026-10-06.md`: 6 findings on 25c36b8, all confirmed and fixed:

| # | Finding | Fix | Checked |
|---|---|---|---|
| A1 | The start button didn't resume the AudioContext: with the normal autoplay policy an audio-only agent could stay silent | `resume()` in the start button's handler. Testing it found F22 (the button ignored clicks during its fade) | real click, normal policy: suspended → running, audio plays |
| A2 | A worklet that failed to load (e.g. CSP) left the agent "ready" and the worker filling an unread queue | the page tells the worker (render loop stopped, writes no-ops), shows a toast and a console error; blob URL revoked | `addModule` rejected: error + worker warning |
| A3 | `ctx.audioOut.write([])` threw on every render | returns 0 | `tests/audio-out/unit.mjs` |
| A4 | Planes beyond `channels` truncated the output | only the planes played set the length; different lengths warn separately from a full queue | unit test |
| A5 | Rounding could deadlock producer and player at some sample rates / quanta | target in whole 128-frame blocks, at least two, and at least two of the player's reported quanta; requests rounded up | unit test (latency 0.01 s, quantum 512) |
| A6 | `{audio}` "from any hook" wasn't true for `updateParameter` | its return value is processed like the others; docs list the hooks | button → notes from `updateParameter` |

## Review of the audio input/output (Codex Astra via pi, 2026-10-06)

`REVIEW_ASTRA_AUDIO_IO_2026-10-06.md`: 8 findings on cee95f5..26589c5, all confirmed and fixed:

| # | Finding | Fix | Checked |
|---|---|---|---|
| I1 | Draining the microphone queue until empty could starve the worker if processAudioBuffer is slower than real time | each read takes at most what was queued when it started | code path |
| I2 | Small fixed output blocks (128 at 48 kHz) could not keep up: one block per 5 ms | each fill renders blocks until the target, within a ~4 ms budget | unit: 0.1 s filled within 20 ms |
| I3 | A large block (16384 at 16 kHz) could not fit the ring buffer, so renderAudio was never called | capacity `outputCapacity()`: max(1 s, 4 x latency, 3 blocks) + resampler room, shared by page and tests | unit: called with 16384 |
| I4 | Free-time agents could get notes before loadAlgorithm finished (a side effect of F21) | notes sent only after the start button; the worker drops notes while a defineAgent agent loads | synth: key before start silent, after start sounds |
| I5 | Audio dropped by a full input queue shifted every later timestamp | the recorder reports dropped samples; the framer skips the gap (timeline advanced, window and resampler restarted); a warning | unit: frame after a 1000-sample gap starts at 1600 |
| I6 | `windowSize` alone left the default hop (1024) larger than the window, and ctx.audio reported a hop not used | hop defaults to the window; ctx.audio reports the hop used; validation uses the same defaults | code path |
| I7 | `playTime()` left out the output resampler's delay | included | code path |
| I8 | The resampler's reported delay was one input sample short | `(halfTaps + 1) / inRate` | unit: impulse lands where delay says (3 rate pairs) |
