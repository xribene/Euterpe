# Loading a model in the agent

The hooks run in a module Web Worker, so a model never blocks the UI.

- **Worker, not page.** `fetch`, `WebAssembly` and (in Chrome) WebGPU work; the DOM, `window` and `document` don't.
- **Files.** Put weights and data in the project's `public/`. They are served from the site root: `public/model/model.json` is `fetch('/model/model.json')`. (Under a Vite `base` other than `/`, prefix it: `import.meta.env.BASE_URL`.)
- **When.** Load in `loadAlgorithm(ctx)`. The start button appears only when it resolves; if it throws, the error is shown on the loading screen. Send progress with `ctx.send({text: 'Loading...'})` (shown on the loading screen). Run one warm-up inference there too: the first call is much slower (compilation, buffer allocation).
- **Per tick.** `processClockEvent` has one tick to answer (150 ms at 100 BPM in 16ths). Keep the model's state (RNN hidden state, KV cache) in module-level variables between ticks. The console warns when the hook is slower than a tick.
- **Dependencies.** `npm install` the runtime and import it in `agent/`. Euterpe's Vite plugin pre-bundles what the agent imports.

## WASM files: let Vite serve them

ML runtimes fetch their `.wasm` binaries at run time, by default from a CDN or next to the script, which breaks in a bundled worker. Import each binary with Vite's `?url` suffix (Vite copies it into the build and gives you its URL) and hand the URLs to the runtime, before the first model loads.

### TF.js (WASM backend)

```bash
npm install @tensorflow/tfjs @tensorflow/tfjs-backend-wasm   # the same version for both (tested: 4.22.0)
```

```js
// agent/hooks.js
import {defineAgent} from 'euterpe/agent';
import * as tf from '@tensorflow/tfjs';
import {setWasmPaths} from '@tensorflow/tfjs-backend-wasm';
import wasm from '@tensorflow/tfjs-backend-wasm/dist/tfjs-backend-wasm.wasm?url';
import wasmSimd from '@tensorflow/tfjs-backend-wasm/dist/tfjs-backend-wasm-simd.wasm?url';
import wasmThreadedSimd from '@tensorflow/tfjs-backend-wasm/dist/tfjs-backend-wasm-threaded-simd.wasm?url';

setWasmPaths({
    'tfjs-backend-wasm.wasm': wasm,
    'tfjs-backend-wasm-simd.wasm': wasmSimd,
    'tfjs-backend-wasm-threaded-simd.wasm': wasmThreadedSimd,
});

let model = null;

export default defineAgent({
    async loadAlgorithm(ctx) {
        ctx.send({text: 'Loading the model...'});
        // WASM, or plain JS if it can't start
        let ok = false;
        try {
            ok = await tf.setBackend('wasm');
        } catch (error) {
            console.warn('TF.js wasm backend failed', error);
        }
        if (!ok) await tf.setBackend('cpu');
        await tf.ready();
        model = await tf.loadLayersModel('/model/model.json');
        tf.tidy(() => model.predict(tf.zeros([1, 16])));   // warm-up
    },
    processClockEvent(clock, ctx) {
        // tf.tidy frees the step's intermediate tensors; dispose() what you keep across ticks
        const next = tf.tidy(() => model.predict(input(clock)).argMax(-1).dataSync()[0]);
        // ...
    },
});
```

The threaded binary is used only when the page is cross-origin isolated (see [hosting.md](hosting.md)); Euterpe's dev server and deploy configs make sure it is.

### onnxruntime-web

```bash
npm install onnxruntime-web   # tested: 1.30.0
```

```js
// agent/ort.js: ORT's WASM settings are global and fixed by the first session, so set them in one module
import * as ort from 'onnxruntime-web/wasm';
import ortWasm from 'onnxruntime-web/ort-wasm-simd-threaded.wasm?url';

ort.env.wasm.wasmPaths = {wasm: ortWasm};
ort.env.wasm.numThreads = 1;     // more threads need a cross-origin isolated page
ort.env.wasm.proxy = false;      // already in a worker
export {ort};
```

```js
// in loadAlgorithm
session = await ort.InferenceSession.create('/model/model.onnx');
```

Tensors: `new ort.Tensor('float32', data, dims)`; `await session.run({input: tensor})`.
