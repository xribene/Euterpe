# Audio-output review

Static review only; no files changed or tests executed.

## Findings

### 1. P1 — Start does not unlock audio playback
**Location:** `packages/euterpe/src/views/Euterpe.vue:1472–1482`

`entryProgram()` sends `{play: true}` but never resumes the AudioContext. The existing `resume()` calls happen during mounting, outside a user gesture.

**Scenario:** On a fresh browser origin with autoplay restricted, an audio-only agent without microphone capture or metronome remains silent after Start. Unlike sampler playback, the worklet does not call a scheduled source’s `start()` to trigger Chrome’s automatic recovery. The smoke test bypasses this policy with `--autoplay-policy=no-user-gesture-required`.

**Fix:** Call `audioContext.resume()` directly from the Start gesture and handle rejection. Test with normal autoplay policy.

**Confidence:** Plausible, browser-policy dependent; the application call path is confirmed.

### 2. P2 — Worklet initialization failure still leaves the agent “ready”
**Location:** `packages/euterpe/src/views/Euterpe.vue:358–360`, `1490–1494`

Failure of `addModule()` only logs an error. Worker initialization independently reports success and starts the render interval; neither readiness nor output availability reflects the failure.

**Scenario:** A deployment’s CSP rejects the blob worklet module. Start appears normally, but output is permanently silent. The worker fills the unconsumed queue and continues polling indefinitely.

**Fix:** Track audio-output initialization separately from agent readiness. Surface failure in the UI and notify the worker to disable output and stop its render interval. Revoke the blob URL in `finally`.

**Confidence:** Confirmed by reading the complete initialization path.

### 3. P2 — An empty planes array throws instead of writing zero frames
**Location:** `packages/euterpe/src/worker/audioOut.js:33–47`

`[]` passes `planes.every(...)`. Its minimum length becomes `Infinity`, so `frames` becomes the available capacity. The copy loop then dereferences `planes[-1]`.

**Scenario:** A renderer returns `[]` when it has no audio. With free queue space, every render attempt throws; the interval retries and logs the error approximately every 5 ms.

**Fix:** Return zero for an empty planes array, or reject it with the existing validation warning before calculating lengths.

**Confidence:** Confirmed by reading the code path.

### 4. P2 — Ignored channels can truncate valid output
**Location:** `packages/euterpe/src/worker/audioOut.js:38–46`

The frame count considers **all** supplied planes, although copying uses only the configured output channels.

**Scenario:** With `channels: 1`, writing `[left256, right0]` writes nothing and warns that the buffer is full, even when empty. The unused right channel determines the length of the valid left output. Likewise, a short third plane truncates stereo output.

**Fix:** Explicitly reject unsupported channel counts, or normalize channel mapping first and calculate lengths only from planes actually consumed. Distinguish mismatched lengths from queue overflow.

**Confidence:** Confirmed by reading the code path.

### 5. P2 — Pull target and playback quantum can deadlock
**Location:** `packages/euterpe/src/worker/audioOut.js:66–75`; `packages/euterpe/src/worker/player-worklet.js:37`

The producer rounds requests down to multiples of 128, while the consumer requires at least one actual output quantum before starting.

**Scenario:** At 48 kHz, `latency: 0.01`, and a 512-frame quantum, the producer queues 384 frames. The remaining target deficit is 96, which rounds to zero forever. Playback waits for 512 frames, so neither side progresses. At 8 kHz and the same latency, even the initial request rounds to zero.

**Fix:** Communicate the actual quantum to the producer and ensure the effective target can hold at least one complete quantum; round the target appropriately.

**Confidence:** Confirmed arithmetic; exposure depends on sample rate/render quantum.

### 6. P2 — “Audio from any hook” is not implemented
**Location:** `templates/_shared/AGENTS.md:68`; `packages/euterpe/src/worker/agentWorker.js:157`, `390–393`

The documentation promises `{audio: channels}` from any hook, but `loadAlgorithm` and `updateParameter` return values never pass through `toMessage()`.

**Scenario:** A Settings button’s `updateParameter` returns `{audio: generatedClip}` as documented. The callback runs, but its audio is silently ignored.

**Fix:** Either process these return values and update their types, or explicitly restrict the documentation to the three processing hooks and recommend `ctx.audioOut.write()`/`ctx.send()` elsewhere.

**Confidence:** Confirmed by reading all relevant hook-dispatch paths.

## Areas found clean

- **Ring-buffer synchronization:** Whole-frame writes and prechecked reads are safe under the existing single-producer/single-consumer arrangement; concurrent activity cannot invalidate those availability guarantees.
- **Normal playback and routing:** Mono duplication, stereo interleaving, shared-context `Tone.connect`, and agent-bus volume/mute routing look correct.
- **Startup ordering:** Both worklet-before-Start and Start-before-worklet orderings send the play command correctly.
- **Pull-loop guards:** Initial loading is respected, calls do not overlap, request sizes are bounded, and exceptions release `busy`.
- **Existing agents:** No additional regression found for agents without `audioOut`.
