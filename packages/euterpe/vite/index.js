/**
 * euterpe/vite: the Vite plugin of a Euterpe project.
 *
 *   // vite.config.js
 *   import {defineConfig} from 'vite';
 *   import euterpe from 'euterpe/vite';
 *   export default defineConfig({plugins: [euterpe()]});
 *
 * It bundles the project's agent (agent/hooks.js and the YAML configs) into Euterpe's UI and agent worker
 * through two virtual modules, sets the cross-origin isolation headers (SharedArrayBuffer) in dev and preview,
 * builds the workers as ES modules and serves the instrument samples.
 */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import yaml from 'js-yaml';
import vue2 from '@vitejs/plugin-vue2';
import {normalizePath} from 'vite';
import {validateAgent} from './validate.js';

const PACKAGE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SAMPLES_DIR = path.join(PACKAGE_DIR, 'assets', 'samples');
const SAMPLES_PATH = 'euterpe/samples/';

const AGENT_MODULE = 'virtual:euterpe-agent';
const CONFIG_MODULE = 'virtual:euterpe-config';

// Euterpe's own browser dependencies. The package is excluded from pre-bundling (Vite has to process the
// `new Worker(new URL(...))` calls in its source), so they are pre-bundled through it explicitly; otherwise
// Vite finds them one by one at runtime and reloads the page each time.
const CORE_DEPS = [
    '@tonaljs/note', '@tonaljs/tonal', 'audiokeys', 'chart.js', 'markdown-it-vue', 'ringbuf.js', 'three', 'tone',
    'tweakpane', 'vexflow', 'vue', 'vue-chartjs/legacy', 'vue-js-modal', 'vue-js-toggle-button',
    'vue-material/dist/components', 'vue-simple-search-dropdown', 'vue-toasted', 'vue2-touch-events', 'vuex',
    'webmidi',
];

// SharedArrayBuffer (the audio and parameter ring buffers, threaded WASM) needs a cross-origin isolated page
const ISOLATION_HEADERS = {
    'Cross-Origin-Embedder-Policy': 'require-corp',
    'Cross-Origin-Opener-Policy': 'same-origin',
};

// The agent's files, and the older names the agent-examples use
const AGENT_FILES = {
    hooks: ['hooks.js', 'hooks.ts', 'hooks.mjs'],
    config: ['config.yaml', 'config.yml'],
    widgets: ['widgets.yaml', 'config_widgets.yaml'],
    players: ['players.yaml', 'config_players.yaml'],
    intro: ['intro.md', 'introModal.md'],
};

const CONTENT_TYPES = {'.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.flac': 'audio/flac'};

/**
 * @param {Object} [options]
 * @param {string} [options.agentDir='agent'] - The agent's folder, relative to the project root.
 * @param {string} [options.samplesBaseUrl] - Where the instrument samples are served from (e.g. a CDN). By
 *     default the plugin serves the samples that ship with Euterpe and copies them into the build.
 * @return {import('vite').Plugin[]}
 */
export default function euterpe(options = {}) {
    const agentDirOption = options.agentDir ?? 'agent';
    const state = {root: process.cwd(), base: '/'};
    const agentDir = () => path.resolve(state.root, agentDirOption);
    const findFile = (kind) => {
        for (const name of AGENT_FILES[kind]) {
            const file = path.join(agentDir(), name);
            if (fs.existsSync(file)) return file;
        }
        return null;
    };
    const samplesBaseUrl = () => options.samplesBaseUrl ?? state.base + SAMPLES_PATH;

    // the two virtual modules, for the page and for the agent worker (whose bundle has its own plugins)
    const virtualModules = () => ({
        name: 'euterpe:virtual-modules',
        resolveId(id) {
            if (id === AGENT_MODULE || id === CONFIG_MODULE) return '\0' + id;
        },
        load(id) {
            if (id === '\0' + AGENT_MODULE) {
                const hooks = findFile('hooks');
                if (!hooks) {
                    this.error(`euterpe: no ${AGENT_FILES.hooks.join(' / ')} in ${agentDir()}`);
                }
                return `import * as agent from ${JSON.stringify(normalizePath(hooks))};\nexport default agent;\n`;
            }
            if (id === '\0' + CONFIG_MODULE) {
                const files = {};
                const readYaml = (kind, required) => {
                    const file = findFile(kind);
                    if (!file) {
                        if (required) this.error(`euterpe: no ${AGENT_FILES[kind].join(' / ')} in ${agentDir()}`);
                        return {};
                    }
                    this.addWatchFile(file);
                    let data;
                    try {
                        data = yaml.load(fs.readFileSync(file, 'utf8')) ?? {};
                    } catch (error) {
                        this.error(`euterpe: ${path.relative(state.root, file)}: ${error.message}`);
                    }
                    files[kind] = {file: normalizePath(path.relative(state.root, file)), data};
                    return data;
                };
                const config = {...readYaml('config', true), ...readYaml('players'), ...readYaml('widgets')};
                // the instruments the build needs samples for
                state.instruments = new Set(Object.values(config.players ?? {})
                    .flatMap((player) => (player?.instruments ?? []).map((instrument) => instrument.id)));
                const {errors, warnings} = validateAgent(files);
                for (const warning of warnings) this.warn(warning);
                if (errors.length) {
                    this.error(`euterpe: the agent's configuration has errors:\n  ${errors.join('\n  ')}`);
                }
                const introFile = findFile('intro');
                if (introFile) this.addWatchFile(introFile);
                const intro = introFile ? fs.readFileSync(introFile, 'utf8') : '';
                return [
                    `export const config = ${JSON.stringify(config)};`,
                    `export const introMarkdown = ${JSON.stringify(intro)};`,
                    `export const samplesBaseUrl = ${JSON.stringify(samplesBaseUrl())};`,
                    `export const configWarnings = ${JSON.stringify(warnings)};`,
                ].join('\n');
            }
        },
    });

    const serveIsolated = (server) => {
        server.middlewares.use((_req, res, next) => {
            for (const [name, value] of Object.entries(ISOLATION_HEADERS)) res.setHeader(name, value);
            next();
        });
    };

    const main = {
        name: 'euterpe',
        config() {
            return {
                // onnxruntime-web uses BigInt literals
                esbuild: {supported: {bigint: true}},
                optimizeDeps: {
                    exclude: ['euterpe'],
                    include: CORE_DEPS.map((dep) => `euterpe > ${dep}`),
                    // also crawl the agent's code, so its ML runtimes (TF.js, onnxruntime-web, ...) are
                    // pre-bundled at startup instead of when a model first loads (which reloads the page)
                    entries: ['**/*.html', `${agentDirOption}/**/*.{js,ts,mjs}`],
                    esbuildOptions: {supported: {bigint: true}},
                },
                // the UI is one large chunk for now (KNOWN_ISSUES F9); don't warn about it in every build
                build: {chunkSizeWarningLimit: 8000},
                // the agent is a module worker; ES output lets it lazy-load (e.g. onnxruntime-web)
                worker: {format: 'es', plugins: () => [virtualModules()]},
            };
        },
        configResolved(config) {
            state.root = config.root;
            state.base = config.base;
        },
        configureServer(server) {
            serveIsolated(server);
            if (options.samplesBaseUrl) return;
            const prefix = state.base + SAMPLES_PATH;
            server.middlewares.use((req, res, next) => {
                let url;
                try {
                    url = decodeURIComponent((req.url ?? '').split('?')[0]);
                } catch {
                    return next();
                }
                if (!url.startsWith(prefix)) return next();
                const file = path.join(SAMPLES_DIR, url.slice(prefix.length));
                // inside SAMPLES_DIR (not a sibling folder whose name starts the same)
                const rel = path.relative(SAMPLES_DIR, file);
                if (!rel || rel.startsWith('..') || path.isAbsolute(rel) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
                    return next();
                }
                res.setHeader('Content-Type', CONTENT_TYPES[path.extname(file)] ?? 'application/octet-stream');
                fs.createReadStream(file).on('error', () => res.destroy()).pipe(res);
            });
        },
        configurePreviewServer(server) {
            serveIsolated(server);
        },
        handleHotUpdate({file, server}) {
            // a YAML or intro change: rebuild the config module and reload the page
            if (path.dirname(file) === agentDir() && /\.(ya?ml|md)$/.test(file)) {
                const module = server.moduleGraph.getModuleById('\0' + CONFIG_MODULE);
                if (module) server.moduleGraph.invalidateModule(module);
                server.ws.send({type: 'full-reload'});
                return [];
            }
        },
        generateBundle() {
            if (options.samplesBaseUrl || !fs.existsSync(SAMPLES_DIR)) return;
            // only the instruments players.yaml lists (all of them if the config wasn't loaded)
            const used = (name) => !state.instruments || state.instruments.has(name);
            const copy = (dir) => {
                for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
                    const file = path.join(dir, entry.name);
                    if (entry.isDirectory()) {
                        if (dir !== SAMPLES_DIR || used(entry.name)) copy(file);
                    } else if (CONTENT_TYPES[path.extname(file)]) {
                        const fileName = SAMPLES_PATH + normalizePath(path.relative(SAMPLES_DIR, file));
                        this.emitFile({type: 'asset', fileName, source: fs.readFileSync(file)});
                    }
                }
            };
            copy(SAMPLES_DIR);
        },
    };

    return [vue2(), virtualModules(), main];
}
