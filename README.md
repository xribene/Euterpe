<div align="center">
    <h1>Euterpe</h1>
    <img src="docs/img/heroImage.svg" alt="Euterpe" width="500" height="200">
    <p>
        <a href="https://euterpeframework.org">Website</a> ·
        <a href="https://euterpeframework.org/guide/demos">Demos</a> ·
        <a href="https://doi.org/10.17743/jaes.2022.0117">Paper (JAES 2023)</a> ·
        <a href="https://www.npmjs.com/package/euterpe">npm</a>
    </p>
</div>

Euterpe is a browser framework for real-time interactive music agents. A person plays (laptop keyboard, MIDI keyboard or microphone) and your agent answers, in the browser, with no server. You write the agent: its hooks in JavaScript and a few YAML files. Euterpe does the rest: MIDI and audio input, the clock and quantization, samplers and audio output, and the UI (score, piano roll, keyboard, Settings widgets).

## Start a project

```bash
npm create euterpe@latest my-agent
cd my-agent
npm install
npm run dev
```

Templates: `empty`, `copycat`, `call-response` and `synth` (MIDI in, audio out). Each project comes with an `AGENTS.md` that documents the whole API, for you and for coding agents. The [package README](packages/euterpe/README.md) has a short agent example, the hooks and deployment notes.

## Systems built with Euterpe

- [BachDuet](https://bachduet.com): real-time counterpoint improvisation with a Bach-inspired agent
- PianoGenie, Copycat, Call and Response, Whistle to Chords and more: see the [demos page](https://euterpeframework.org/guide/demos)

## This repository

A pnpm workspace:

| Folder | What |
|---|---|
| `packages/euterpe` | the framework, published as [`euterpe`](https://www.npmjs.com/package/euterpe): runtime, Vite plugin, `euterpe` CLI, types and schemas |
| `packages/create-euterpe` | the scaffolder, published as [`create-euterpe`](https://www.npmjs.com/package/create-euterpe) |
| `templates/` | the project templates `npm create euterpe` copies |
| `examples/` | agents from the original (pre-npm) Euterpe |
| `tests/`, `tools/` | smoke tests and the release rehearsal |

```bash
pnpm install
pnpm dev          # the empty template against the local package
pnpm rehearse     # publish to a local registry, then create, build and smoke every template
```

## Citation

If you use Euterpe in your research, please cite:

> Y. Zang\*, C. Benetatos\*, and Z. Duan, "Euterpe: A Web Framework for Interactive Music Systems," *Journal of the Audio Engineering Society*, vol. 71, no. 11, pp. 738–752, 2023. doi:[10.17743/jaes.2022.0117](https://doi.org/10.17743/jaes.2022.0117)
>
> \* Equal contribution.

```bibtex
@article{zang2023euterpe,
  author  = {Zang, Yongyi and Benetatos, Christodoulos and Duan, Zhiyao},
  title   = {Euterpe: A Web Framework for Interactive Music Systems},
  journal = {Journal of the Audio Engineering Society},
  volume  = {71},
  number  = {11},
  pages   = {738--752},
  year    = {2023},
  doi     = {10.17743/jaes.2022.0117}
}
```

## Licence

MIT, © Christodoulos Benetatos and Yongyi Zang.
