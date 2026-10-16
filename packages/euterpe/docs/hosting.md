# Hosting: cross-origin isolation

Euterpe passes audio, widget values and the live canvas between the page, the agent worker and the audio thread through `SharedArrayBuffer`s, and threaded WASM (TF.js, onnxruntime-web) needs them too. Browsers allow `SharedArrayBuffer` only on a **cross-origin isolated** page, one served with:

```text
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

Check in the browser console: `self.crossOriginIsolated` must be `true`. Without it `SharedArrayBuffer` is undefined and the UI fails to start.

## Who sets the headers

| Where | Headers |
|---|---|
| `npm run dev`, `npm run preview` | set by `euterpe/vite` |
| `npm run smoke -- --build` | set by its static server |
| Netlify | the project's `netlify.toml` (or a `public/_headers` file) |
| Vercel | the project's `vercel.json` |
| GitHub Pages, `python3 -m http.server`, any host without custom headers | not set: use coi-serviceworker (below) |

## Hosts that can't set headers: coi-serviceworker

[coi-serviceworker](https://github.com/gzuidhof/coi-serviceworker) is a small service worker that adds the two headers to every response. Copy `coi-serviceworker.js` (from the npm package `coi-serviceworker` or its repository) into the project's `public/`, and load it first in `index.html`'s `<head>`:

```html
<script src="/coi-serviceworker.js"></script>
```

The first visit installs the worker and reloads the page once; from then on the page is isolated. It needs HTTPS (or `localhost`).

## Cross-origin files under COEP

With `require-corp`, files from another origin (a model on a CDN or a bucket, an image) load only if that server allows it: CORS (`Access-Control-Allow-Origin`) for `fetch`, or `Cross-Origin-Resource-Policy: cross-origin`. Files in the project's `public/` are same-origin and always load. A blocked file shows as a network error in the console (`ERR_BLOCKED_BY_RESPONSE`).
