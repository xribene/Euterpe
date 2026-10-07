# Findings report

Read-only review; no tests executed. “Confirmed” means traced through the relevant code paths. Issues already listed in `KNOWN_ISSUES.md` are excluded.

## 1. High — Static-file containment checks permit sibling-directory traversal

**Locations:** `packages/euterpe/cli/serve.js:27`, `packages/euterpe/vite/index.js:168`  
**Confidence:** Confirmed.

Both checks use `file.startsWith(root)` without a directory boundary. Serving `/project/dist` also permits files beneath `/project/dist-private`.

**Scenario:** Request `/%2e%2e%2fdist-private/secret.txt`. Decoding and joining produces `/project/dist-private/secret.txt`, which passes the check and is served. The samples middleware has the equivalent vulnerability for siblings beginning with `samples`.

**Fix:** Validate containment using `path.relative`, rejecting parent escapes and absolute results. Resolve real paths if symlinks must not escape the root.

## 2. Medium — Hooks can execute before asynchronous initialization finishes

**Location:** `packages/euterpe/src/worker/agentWorker.js:342–344`  
**Confidence:** Confirmed.

Audio and parameter observers start before `loadDefinedAgent()` finishes. Neither observer checks loading state.

**Scenario:** A slow `loadAlgorithm` initializes a model after fetching weights. An intro-dropdown change invokes `updateParameter` during that fetch; with active microphone capture, `processAudioBuffer` can also run. Hooks access an uninitialized model despite using the advertised initialization hook.

**Fix:** Gate dependent hooks on initialization completion. Buffer parameter changes or explicitly distinguish controls allowed during loading; discard or defer audio until ready.

## 3. Medium — Schema-valid note-only configuration can leave startup hanging

**Locations:** `packages/euterpe/schema/config.schema.json:7`, `packages/euterpe/src/worker/agentWorker.js:214,342,353`  
**Confidence:** Confirmed.

`audioModeSettings` is optional in the schema, but worker initialization unconditionally dereferences it—even with audio mode disabled. The outer initialization catch only logs the exception.

**Scenario:** Remove `audioModeSettings` from the empty template while keeping `audioMode: false`. Validation succeeds, `initAudio` throws before `loadAlgorithm`, and neither SUCCESS nor ERROR reaches the loading screen.

**Fix:** Skip audio initialization when disabled, or supply validated defaults. Report all initialization failures through the UI error protocol.

## 4. Medium — Changing Copycat’s delay can leave an unmatched note-on

**Location:** `templates/copycat/agent/hooks.js:12–24`  
**Confidence:** Confirmed.

The note-off uses the current delay rather than the delay used for its corresponding note-on.

**Scenario:** An onset at tick N schedules playback at N+8. Reduce Delay to 1 and release at N+2: the off executes at N+3, before the on at N+8. `sounding` is already cleared, so no subsequent off is generated.

**Fix:** Preserve the onset’s delay for its matching release, or explicitly cancel/reschedule pending notes when Delay changes.

## 5. Medium — ReaLchords model switching releases pending notes too early

**Location:** `apps/realchords/agent/hooks.js:74`  
**Confidence:** Confirmed.

`renderer.flush()` forgets its notes and sends immediate offs, but those notes can still have next-tick ons queued in the UI.

**Scenario:** A clock hook schedules a chord with `{tick: 1}`. Switch models before that tick: immediate offs run first and clear renderer tracking. The queued chord then starts. If the newly reset model produces silence, nothing releases that chord.

**Fix:** Coordinate switching with pending playback: cancel queued output by generation, or release after pending ons have executed. Also invalidate in-flight old-model output.

## 6. Medium — Earlier model loads can overwrite a newer selection

**Location:** `apps/realchords/agent/hooks.js:20–27`  
**Confidence:** Confirmed.

Every `useModel` completion assigns `player`, regardless of whether its request is still current. Parameter hooks run concurrently.

**Scenario:** With GAPT cached, select uncached ReaLchords, then switch back to GAPT before loading finishes. GAPT becomes active immediately, but the earlier ReaLchords request subsequently overwrites it. The dropdown and `ctx.params` still indicate GAPT.

**Fix:** Use a monotonically increasing selection generation; only the latest request may reset/install a player or report completion.

## 7. Medium — Call-response treats sustained notes as silence

**Location:** `templates/call-response/agent/hooks.js:18–25`  
**Confidence:** Confirmed.

Phrase completion depends solely on time since the last MIDI event, not whether any user notes remain held.

**Scenario:** Hold one note for four seconds. After 1.5 seconds without another event, the agent starts answering and clears the phrase while the user is still playing. The eventual release becomes a separate phrase.

**Fix:** Track held notes and require both an empty held-note set and the silence interval before answering.

## 8. Medium — Production smoke tests fail for non-root Vite bases

**Location:** `packages/euterpe/cli/index.js:50–54`  
**Confidence:** Confirmed.

The build respects `config.base`, but the static server always mounts `dist` at `/` and smoke opens `/`.

**Scenario:** Set `base: '/music/'`. Built HTML requests `/music/assets/...`, while the server looks for `dist/music/assets/...`; the actual files are under `dist/assets`. A valid deployment configuration therefore fails smoke.

**Fix:** Mount the static server at the configured base pathname and open that URL, or use an appropriately configured preview server.

## 9. Medium — Malformed URL encoding terminates the static server

**Location:** `packages/euterpe/cli/serve.js:25`  
**Confidence:** Confirmed.

`decodeURIComponent` executes directly in the HTTP callback without exception handling.

**Scenario:** A request for `/%` throws `URIError`, escaping the callback and terminating the smoke process instead of returning an HTTP error.

**Fix:** Catch decoding failures and return 400. Handle file-stream errors as well so filesystem failures cannot terminate the server.

## 10. Medium — Clock-event types promise arrays that may be absent

**Location:** `packages/euterpe/types/agent.d.ts:107–109`  
**Confidence:** Confirmed.

Both note collections are required arrays in `ClockEvent`. However, `Euterpe.vue:702–709` omits each property when its corresponding configuration flag is disabled; the worker preserves that omission.

**Scenario:** With `quantizedEvents: false`, a hook accesses `clock.userQuantizedNotes.length`. This typechecks against the public API but throws every tick, while the agent remains reported ready.

**Fix:** Always supply empty arrays, or declare these properties optional and document the required guards.

## 11. Low — Interactive template names silently select the empty template

**Location:** `packages/create-euterpe/index.js:100`  
**Confidence:** Confirmed.

`Number(answer) || 1` chooses the first template for any nonnumeric answer, making the subsequent name lookup unreachable.

**Scenario:** Enter `copycat` at the template prompt. The generator creates `empty`, rather than selecting Copycat or rejecting the input. Invalid text also silently selects empty.

**Fix:** Handle an empty answer, numeric selection, and template-name selection separately; reject unknown input.

## Other areas reviewed

No additional serious findings in the legacy-hook module unwrapping, clock/note queue rejection recovery, `ctx.now()`, shared AudioContext construction, stable note insertion, changed score-warning logic, ordinary scaffold copying, or the normal eject path. Public constants, context helpers, schemas, and shared agent documentation were also checked against their consumers.
