# Audio I/O review

Static review only; no files changed or tests executed. Findings exclude previously reviewed, unchanged issues.

## Findings

### 1. P2 — Draining microphone input can monopolize the worker indefinitely

**Location:** `packages/euterpe/src/worker/agentWorker.js:105–130`

The reader drains until the queue becomes empty, invoking synchronous audio hooks inside that loop. The recorder continues producing on another thread.

**Scenario:** At 16 kHz with hop 256, frames arrive every 16 ms. A synchronous model taking 20 ms per frame eventually leaves the queue continuously nonempty. The drain never yields, starving note events, parameter changes, output rendering and control messages.

**Fix:** Bound each drain by a snapshot of available samples or a processing budget, then yield. Define an explicit overload/drop policy.

**Confidence:** Confirmed by the code path and producer/consumer rate arithmetic.

### 2. P2 — Small fixed output blocks cannot sustain playback

**Location:** `packages/euterpe/src/worker/audioOut.js:119–131`

With `blockSize` configured, the loop renders only one block per 5 ms interval, regardless of the remaining deficit.

**Scenario:** `sampleRate: 48000, blockSize: 128` produces at most 25,600 frames/second while playback consumes 48,000. Even an instantaneous renderer repeatedly underruns; increasing latency only postpones the problem.

**Fix:** Render multiple fixed-size blocks sequentially per refill until the target is reached, with a bounded work budget and the existing non-reentrancy guard.

**Confidence:** Confirmed arithmetic.

### 3. P2 — Valid large blocks can prevent rendering from ever starting

**Location:** `packages/euterpe/src/views/Euterpe.vue:329–333`; `packages/euterpe/src/worker/audioOut.js:118–121`

Ring-buffer capacity depends on latency but not the configured block size. The renderer refuses to run unless an entire block fits.

**Scenario:** On a 48 kHz page, `sampleRate: 16000, blockSize: 16384, latency: 0.1` allocates 48,000 page frames. The empty queue reports only 15,950 writable agent frames after the resampler margin—less than one block. `renderAudio` is never called, and playback remains silent.

**Fix:** Size the queue using the effective block/quantum target and resampling margin, or reject combinations that cannot fit.

**Confidence:** Confirmed end-to-end arithmetic.

### 4. P2 — Free-time note events can reach an agent before loading finishes

**Location:** `packages/euterpe/src/views/Euterpe.vue:718–724`; `packages/euterpe/src/worker/agentWorker.js:304–319`

The new clock-independent dispatch has no readiness guard. Worker note dispatch likewise does not check `ctx._loading`.

**Scenario:** An event-only agent is awaiting model downloads in `loadAlgorithm`. Laptop-keyboard handlers are already installed, so pressing a key on the loading screen invokes `processNoteEvent` against an uninitialized model. Previously, the stopped clock prevented this normal startup path.

**Fix:** Gate note dispatch until initialization succeeds, or explicitly queue/drop startup notes in the worker. Handle note-on/off pairs consistently.

**Confidence:** Confirmed by the complete initialization and input paths.

### 5. P2 — Input timestamps permanently lose alignment after dropped audio

**Location:** `packages/euterpe/src/worker/recorder-worklet.js:34–47`; `packages/euterpe/src/worker/agentWorker.js:111–116`

Timestamps are reconstructed from one initial timestamp and the number of samples successfully dequeued. The recorder ignores partial/failed enqueue results and communicates no capture position or discontinuity.

**Scenario:** The worker stalls for two seconds while the one-second input queue fills. Approximately one second is dropped. After the retained audio drains, newly captured samples receive timestamps approximately one second too early, permanently misaligning audio with notes and `ctx.now()`.

**Fix:** Preserve capture positions across the transport, including explicit gap information. On a gap, advance the timeline and reset framing/resampling state or insert appropriately timestamped silence.

**Confidence:** Confirmed by tracing overflow through timestamp construction.

### 6. P2 — Optional framing settings bypass validation and produce incorrect metadata

**Location:** `packages/euterpe/vite/validate.js:81–84`; `packages/euterpe/src/worker/agentWorker.js:217–223`

Validation compares window and hop only when both are explicitly supplied. Runtime defaults them independently, clamps the actual hop, but publishes the unclamped value in `ctx.audio`.

**Scenario:** `audioModeSettings: {windowSize: 512}` passes validation. Runtime defaults hop to 1024, actually emits frames every 512 samples, and reports `ctx.audio.hopSize === 1024`. A model using that metadata processes the stream at the wrong assumed cadence.

**Fix:** Normalize defaults before validation and initialization. Either reject the effective invalid combination or choose a compatible default; publish the actual hop used.

**Confidence:** Confirmed by schema, validation and runtime paths.

### 7. P3 — `playTime()` omits output-resampler latency

**Location:** `packages/euterpe/src/worker/audioOut.js:25–26, 46–51`

The prediction includes queued page frames and device latency, but not the filter history ahead of newly supplied input.

**Scenario:** During continuous 8 → 48 kHz output, a newly written impulse is delayed by approximately another 3 ms inside the resampler. `playTime()` predicts it early, undermining input/output alignment for models using the advertised timing API.

**Fix:** Account for resampler latency and phase when predicting the playback time of newly supplied samples. Document behavior during prebuffering or suspension.

**Confidence:** Confirmed by tracing the resampler’s retained history.

### 8. P3 — Reported resampler delay is one input sample too short

**Location:** `packages/euterpe/src/worker/resampler.js:35–37, 75–77`

The initial history contains `2 * halfTaps` zeros, while the first interpolation center is `halfTaps - 1`. Output sample zero therefore represents input position `-(halfTaps + 1)`, but `delay` reports only `halfTaps / inRate`.

**Scenario:** At 16 → 48 kHz, an impulse at input sample zero is centered at output sample 75, rather than the 72 implied by the reported delay. Consequently, input `frame.time` is one input sample too late.

**Fix:** Align initialization with the advertised delay, or report the actual delay. Add impulse-position tests, not only frequency/RMS tests.

**Confidence:** Confirmed index arithmetic.

## Areas found clean

- **Resampler core:** Phase-table endpoint handling, downsampling cutoff, retained-history indexing and bounded steady-state storage look sound apart from delay accounting.
- **Output writes:** Conservative space margins, accepted-prefix resampling, channel normalization and whole-frame interleaving look safe.
- **Framing:** Normal overlap, sample copying and frame positions are consistent; returned frames own their data.
- **Microphone setup:** Constraints shape, mono duplication, variable block sizes and the disconnected-input guard look correct.
- **Synth:** No serious additional issue found in voice stealing, fixed-setting ADSR behavior, filter bounds or output limiting. CPU performance was not measured.
- **Earlier fixes:** Start/resume ordering, opacity-only animation, output-failure notification and `updateParameter` output routing look correct.
- **Tests:** Existing coverage supports normal-rate operation, but does not exercise the overload, small-block, capacity and timestamp-discontinuity cases above.
