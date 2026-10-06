/**
 * onnxruntime-web for every ONNX model of the agent (the BachDuet transformer and the ReaLchords/GAPT chord
 * models). ORT's WASM settings are global per worker and fixed when the first session is created, so they
 * live here, in one place, and every model imports `ort` from this module.
 *
 * Threads: ?ortThreads=N in the page URL (passed to the worker as self.urlParams by agent.js), default 1.
 * Multiple threads need a cross-origin isolated page (COOP/COEP: public/_headers in production, the
 * Vite dev server in vite.config.js); otherwise ORT falls back to 1 thread.
 */
import * as ort from 'onnxruntime-web/wasm';
import ortWasmUrl from 'onnxruntime-web/ort-wasm-simd-threaded.wasm?url';

const requested = parseInt(self.urlParams?.ortThreads ?? '1', 10);
export const ORT_THREADS = Number.isFinite(requested) && requested > 0 ? Math.min(requested, 16) : 1;

// Let Vite serve the WASM binary (same version as the JS) instead of fetching it from a CDN.
ort.env.wasm.wasmPaths = {wasm: ortWasmUrl};
ort.env.wasm.numThreads = ORT_THREADS;
ort.env.wasm.proxy = false;
console.log(`onnxruntime-web ${ort.env.versions?.web ?? ''}: wasm, numThreads ${ORT_THREADS}` +
    ` (crossOriginIsolated: ${self.crossOriginIsolated})`);

export {ort};
