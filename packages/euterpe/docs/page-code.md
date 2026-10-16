# Your own page code: widgets that talk to the agent

The project owns `index.html`, which calls `mount()` from `euterpe`. Anything else on that page (a custom controller, buttons, a canvas, a camera feed) is the project's own code, and can talk to the agent without changing Euterpe:

```js
// index.html (or a module it imports)
import {mount} from 'euterpe';

const euterpe = mount('#app');
euterpe.sendToAgent({button: 3, down: true});      // -> the agent's processPageMessage(data, ctx)
const stop = euterpe.onAgentMessage((data) => {     // <- what the agent sends as {page: data}
    console.log('from the agent', data);
});
```

```js
// agent/hooks.js
export default defineAgent({
    processPageMessage(data, ctx) {
        if (!data.down) return [ctx.noteOff(60 + data.button)];
        return {
            notes: [ctx.noteOn(60 + data.button)],
            page: {lit: data.button},              // to the page's onAgentMessage listeners
        };
    },
});
```

| API | |
|---|---|
| `mount(el = '#app')` | Returns `{vm, sendToAgent, onAgentMessage}` (`EuterpeApp` in the types); `vm` is the root Vue instance |
| `sendToAgent(data)` | `data`: anything structured-cloneable (plain objects, arrays, numbers, strings, typed arrays). Delivered in order. Sent before the agent has loaded, it waits until `loadAlgorithm` has finished |
| `processPageMessage(data, ctx)` | The agent's hook. Returns what any hook returns (notes, `{notes, text, ...}`), plus `page` |
| `{page: data}` | From any hook's return value, or `ctx.send({page: data})` at any time (e.g. `{page: {ready: true}}` at the end of `loadAlgorithm`) |
| `onAgentMessage(listener)` | Calls `listener(data)` for each `{page: data}`. Returns a function that removes the listener |

Agents written the original way (named exports using `self.*`) get `processPageMessage(data)` without `ctx` and return MICP messages; the page key is `self.messageType.PAGE`.

Notes the agent plays show on the keyboard and piano roll as the agent's. Input sent this way is not a user note: it doesn't light the on-screen keyboard or appear in the piano roll or score as the user's. (`window.__euterpe.noteOn` is a test handle that plays a user note, see [testing.md](testing.md).)

## Keys

Euterpe's laptop keyboard listens on `document`: the bottom row `Z S X D C V G B H N J M , L . ; /` plays C4 to E5 and the top row `Q 2 W 3 E R 5 T 6 Y 7 U I 9 O 0 P [ = ]` plays C5 to G6; Space starts and stops the clock. Of the digits, `2 3 5 6 7 9 0` are notes; `1 4 8` are free. To use a key Euterpe also uses, take it first with a capture-phase listener on `window` and stop it there:

```js
window.addEventListener('keydown', (e) => {
    if (e.code !== 'Digit2' || e.target.closest?.('input, textarea')) return;
    e.stopPropagation();           // Euterpe's listener on document never sees it
    if (!e.repeat) euterpe.sendToAgent({button: 1, down: true});
}, true);
// and the same for keyup
```

## Layout

Euterpe's UI fills the page. Place your widget with `position: fixed` and a `z-index` above it (e.g. 1000).
