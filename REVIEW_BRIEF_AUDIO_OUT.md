# Review brief: agent audio output (commit 25c36b8)

Read `REVIEW_BRIEF.md` first for what Euterpe is and how the repo is laid out. This is a follow-up review of one feature. Report findings; do not change files.

## The feature

Until now an agent could only play notes (through the samplers). This commit lets it play audio it generates (synthesis, a neural audio model), the way the microphone already reaches it, in reverse:

- `config.yaml`: `interactionMode.audioOut: true`, `audioOutSettings: {channels: 1|2, latency: seconds}` (schema in `packages/euterpe/schema/config.schema.json`).
- Page (`packages/euterpe/src/views/Euterpe.vue`, search `audioOut` / `startAudioOut` / `entryProgram`): creates a SharedArrayBuffer ring buffer holding max(1 s, 4 x latency), passes it to the worker at init, loads `src/worker/player-worklet.js` (concatenated with `ringbuf-classic.js`) as an AudioWorklet on the shared AudioContext, connects it into the agent's mixer bus (a Tone.Channel), and sends `{play: true}` on the start button. Underrun reports from the worklet become a throttled console warning; `window.__euterpe.audioOut` exposes the counters (`src/utils/handle.js`).
- Worklet (`src/worker/player-worklet.js`): plays interleaved frames; silent until `{play: true}`; starts when `prebuffer` (latency/2) frames are queued; on an underrun plays silence and waits for the prebuffer again; reports `{played, underruns, playing}` every 0.5 s.
- Worker (`src/worker/audioOut.js`, `agentWorker.js` init and `loadDefinedAgent`, `context.js` `toMessage`): `ctx.audioOut` (`write`, `space`, `buffered`), the `renderAudio(frames, ctx)` pull loop (every 5 ms, one call at a time, fills up to `latency` seconds in multiples of 128 frames, at most 4096), and the `audio` key in a hook's return value (or a bare Float32Array).
- Types (`types/agent.d.ts`, `types/index.d.ts`), `templates/_shared/AGENTS.md` "Audio output", validation rule in `vite/validate.js`.
- Test fixture `tests/audio-out` (a 440 Hz sine: pull, `?mode=push`, `?mode=slow`) and `tools/smoke/audio-out.mjs`.

Diff of the commit: `.review/audio-out.diff`.

## Look for

- Real-time correctness: ring buffer semantics (ringbuf.js 0.3.6: `enqueue` may write part of a buffer; `dequeue` returns what it read), whole-frame interleaving, channel mapping (mono to both outputs, a planes array shorter or longer than `channels`), what happens when the worklet's quantum is not 128 frames, allocation or GC in `process()`.
- The pull loop: can it stall, re-enter, run before the agent is ready, render negative or huge frame counts, keep running after errors; interaction with `ctx._loading`; timer drift.
- Lifecycle: the page code runs `startAudioOut` without awaiting it (the worklet may be ready after the start button; after the agent starts writing); `{play: true}` ordering; what happens if `addModule` fails; whether anything leaks or keeps running.
- Mixer routing: `Tone.connect(nativeNode, Tone.Channel)` on the shared AudioContext; volume/mute.
- API and docs: types vs runtime (`write` return value, `buffered`/`space` units), AGENTS.md vs behaviour, warnings that could fire wrongly or not fire.
- Anything that breaks existing behaviour for agents without `audioOut`.

Out of scope: everything else in the repo (reviewed before), `KNOWN_ISSUES.md` items.

## What was checked (context)

The fixture played a 441 Hz peak at 44.1 kHz with 0 underruns over 5 s in pull and push mode, was silent before the start button and with the agent bus muted, and the slow renderer underran and warned once; templates, ReaLchords and BachDuet smoke checks passed.

## What to report

As in `REVIEW_BRIEF.md`: findings most severe first, each with file:line, the problem, a concrete scenario, a suggested fix and your confidence. Say briefly which areas you found clean.
