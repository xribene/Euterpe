# Euterpe agent

A real-time interactive music agent built with [Euterpe](https://github.com/xribene/Euterpe).

```bash
npm install
npm run dev       # open the URL, press start, play on the keyboard
npm run build     # static site in dist/
```

The agent is in `agent/hooks.js`; its settings are the YAML files in `agent/`. See `AGENTS.md` for the hooks and `ctx`.

Deploying: `dist/` must be served with the headers `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp`. `netlify.toml` and `vercel.json` already set them.
