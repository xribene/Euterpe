# create-euterpe

Creates a [Euterpe](https://www.npmjs.com/package/euterpe) project: a real-time interactive music agent that runs in the browser.

[Website](https://euterpeframework.org) · [Paper (JAES 2023)](https://doi.org/10.17743/jaes.2022.0117) · [Source](https://github.com/xribene/Euterpe)

```bash
npm create euterpe@latest my-agent
cd my-agent
npm install
npm run dev
```

With no options it asks for a directory and a template. To skip the questions:

```bash
npm create euterpe@latest my-agent -- --template copycat
```

| Template | What the agent does |
|---|---|
| `empty` | Hooks that do nothing yet: start here |
| `copycat` | Copies your notes on the 16th-note grid, delayed and transposed |
| `call-response` | Waits for your phrase, then answers it in your rhythm |
| `synth` | A polyphonic synthesizer: your notes in, audio out |

`--force` writes into a directory that isn't empty.

Each project contains:
- the agent (`agent/hooks.js` and its YAML files);
- a Vite config with `euterpe/vite`;
- `AGENTS.md`, the API reference for you and for coding agents;
- deploy configs for Netlify and Vercel, with the cross-origin isolation headers Euterpe needs;
- the scripts `npm run dev`, `build`, `preview`, `typecheck` and `smoke` (a headless-browser check).

The templates are MIT-0 (no attribution needed). This package itself is MIT.
