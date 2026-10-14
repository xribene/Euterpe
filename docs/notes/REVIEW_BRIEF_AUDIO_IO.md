# Review brief: synth template, audio input/output for model builders (commits cee95f5..HEAD)

Read `REVIEW_BRIEF.md` (the repo) and `REVIEW_BRIEF_AUDIO_OUT.md` (the audio output, reviewed before: `REVIEW_ASTRA_AUDIO_OUT_2026-10-06.md`) first. Report findings; do not change files. Diff: `.review/audio-io.diff`.

## What changed

1. **Fixes of the previous review** (A1-A6 in `KNOWN_ISSUES.md`, "Review of the audio output"): `resume()` on the start button, worklet failure path (`control: 'audioOutUnavailable'`), `write()` edge cases, block-aligned pull target honouring the player's reported quantum (`control: 'audioOutQuantum'`), `updateParameter` output routed like other hooks.
2. **Start button** (F22): its fade-in animated `display`/`visibility`; now opacity only.
3. **Event mode** (F21): agents without `gridBased` get the user's notes without the clock running (`Euterpe.vue` `processUserNoteEvent`).
4. **Synth template** (`templates/synth/agent/hooks.js`): 16 voices, sine / triangle / PolyBLEP saw and square, ZDF state-variable low-pass, ADSR, `renderAudio` at 30 ms latency, mono.
5. **Audio input** (`src/worker/audioIn.js`, `agentWorker.js` `initAudio` / `_readFromQueue`, `recorder-worklet.js`, `Euterpe.vue` getUserMedia / recorder node / `audioInStart`): frames of `windowSize` every `hopSize` at `audioModeSettings.sampleRate` (resampled), each with `start` / `time` / `sampleRate`; microphone speech processing off by default; recorder forced to stereo and any block size; the reader drains the ring buffer.
6. **Resampler** (`src/worker/resampler.js`): streaming windowed-sinc, used for input and output.
7. **Audio output** (`src/worker/audioOut.js`): `audioOutSettings.sampleRate` (resampled on write; counts in the agent's frames), `blockSize` (renderAudio always asked for exactly that), `playTime()`; player reports `peak`; `euterpe smoke` counts audio as an answer.
8. Schema (`audioModeSettings.sampleRate / echoCancellation / noiseSuppression / autoGainControl`, `audioOutSettings.sampleRate / blockSize`), validation (hop > window is an error), types (`AudioFrame`, `AudioOut`), `AGENTS.md` sections "Audio input" / "Audio output".
9. Tests: `tests/audio-io/*.test.mjs` (unit), `tests/audio-io-app` + `tools/smoke/audio-io.mjs`, `tests/audio-out` + `tools/smoke/audio-out.mjs`.

## Look for

- Resampler correctness: index arithmetic, the kept history (`keep`), phase rounding at `p === phases`, upsampling vs downsampling filter, numerical edge cases (ratio 1 is bypassed), memory growth over hours.
- Framer: frame positions after resampling, `consumed` vs the resampler delay in `frame.time`, behaviour when `hopSize > windowSize` (clamped), allocation per frame.
- Output with a different rate: `space()` margin vs what the resampler can emit for a given input, `buffered()` / `playTime()` units, partial writes losing resampler state, `blockSize` vs `space` (can the loop stall if space never reaches a block?), quantum conversion between rates.
- Timestamps: the page/worker clock mapping (`timeOrigin`, `audioInStart` via `currentTime` vs `performance.now()`), and whether `frame.time` is consistent with `ctx.now()` and notes' `createdAt.seconds`.
- The microphone: constraints shape, the recorder's `started` message, interleaving for mono/stereo, what happens before the source is connected.
- The synth: voice stealing, envelope edge cases (sustain 0, attack 1 ms, release of a voice still in attack), retriggering a held key, the filter at extreme cutoff / resonance, denormals or NaN, CPU per block with 16 voices.
- The start button / resume / autoplay changes and F21 (could event notes now reach agents that don't expect them?).
- Types and AGENTS.md vs the runtime.

Out of scope: anything reviewed before and unchanged; `KNOWN_ISSUES.md` items.

## Context (checked)

Unit tests pass (resampler: 440 Hz kept at five rate pairs, a 10 kHz tone at -90 dB after 48 -> 16 kHz, block-size independent; framer exact sample by sample; output at 16 kHz and with blockSize 2048). Browser: mic processing off on the track; 16 kHz frames of 512 every 256; frames reach the agent ~13 ms after capture; a 16 kHz sine in 2048 blocks plays at 438.7 Hz on a 44.1 kHz page, 0 underruns; the synth plays A4 at ~440 Hz, its filter and release behave, key to sound median 33 ms. Templates, ReaLchords, BachDuet (replay identical) and the rehearsal pass.

## What to report

As before: findings most severe first, file:line, problem, concrete scenario, suggested fix, confidence; areas found clean.
