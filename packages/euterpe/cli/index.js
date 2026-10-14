#!/usr/bin/env node
/**
 * The `euterpe` command, run in a Euterpe project (npx euterpe <command>, or the project's npm scripts).
 *
 *   euterpe smoke [url]        check the agent in a headless browser: starts the dev server unless a URL is given
 *         --build              check the production build instead, served like a static host (COOP/COEP)
 *         --mode=name          the Vite mode (vite.config.js gets it, e.g. two builds of one agent)
 *         --expect-answer      fail if the agent plays nothing in answer to the test phrase
 *         --set=slider:3:7     change a widget first (kind:id:value, as ctx.params)
 *         --wait=ms --json --logs --screenshot=file.png
 *   euterpe eject [dir]        copy Euterpe into the project (default ./euterpe) to change it freely
 */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const PACKAGE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [command, ...rest] = process.argv.slice(2);
const flags = Object.fromEntries(rest.filter((a) => a.startsWith('--')).map((a) => {
    const [key, ...value] = a.slice(2).split('=');
    return [key, value.length ? value.join('=') : true];
}));
const positional = rest.filter((a) => !a.startsWith('--'));
const tty = process.stdout.isTTY;
const color = (code) => (s) => (tty ? `\x1b[${code}m${s}\x1b[0m` : s);
const [green, red, yellow, dim] = [color(32), color(31), color(33), color(2)];

function fail(message) {
    console.error(red(`euterpe: ${message}`));
    process.exit(1);
}

async function smokeCommand() {
    const {smoke} = await import('./smoke.js');
    const options = {
        expectAnswer: Boolean(flags['expect-answer']),
        wait: flags.wait ? Number(flags.wait) : undefined,
        screenshot: typeof flags.screenshot === 'string' ? flags.screenshot : null,
        set: rest.filter((a) => a.startsWith('--set=')).map((a) => {
            const [kind, id, value] = a.slice(6).split(':');
            return [kind, Number(id), Number(value)];
        }),
    };
    let url = positional[0];
    let stop = async () => {};
    if (!url) {
        // the project's own Vite, with its vite.config.js
        const vite = await import('vite');
        const mode = typeof flags.mode === 'string' ? flags.mode : undefined;
        if (flags.build) {
            console.error(dim(`building${mode ? ` (mode ${mode})` : ''}...`));
            await vite.build({root: process.cwd(), logLevel: 'warn', mode});
            const config = await vite.resolveConfig({root: process.cwd(), mode}, 'build');
            const {serveStatic} = await import('./serve.js');
            const server = await serveStatic(path.resolve(config.root, config.build.outDir), 0, config.base);
            url = server.url;
            stop = server.close;
        } else {
            const server = await vite.createServer({root: process.cwd(), logLevel: 'error', mode, server: {port: 0}});
            await server.listen();
            url = server.resolvedUrls.local[0];
            stop = () => server.close();
        }
    }
    let report;
    try {
        report = await smoke(url, options);
    } finally {
        await stop();
    }
    if (flags.json) {
        if (!flags.logs) delete report.logs;
        console.log(JSON.stringify(report, null, 1));
    } else {
        const mark = (ok) => (ok ? green('✓') : red('✗'));
        console.log(`Euterpe smoke check: ${url}${flags.build ? ' (production build)' : ''}`);
        console.log(`  ${mark(report.crossOriginIsolated)} cross-origin isolated`);
        console.log(`  ${mark(true)} agent ready after ${(report.readyAfterMs / 1000).toFixed(1)} s`);
        console.log(`  ${mark(report.started && report.ticksPerSecond > 0)} UI started, clock at ${report.ticksPerSecond} ticks/s`);
        if (report.params) console.log(`  ${dim(`widgets: ${JSON.stringify(report.params)}`)}`);
        const answered = report.agentNoteOns.length > 0;
        if (report.audioOut) {
            const a = report.audioOut;
            console.log(`  ${mark(a.underruns === 0)} audio output: ${a.played} frames played, peak ${a.peakDuringPhrase} during the phrase, ${a.underruns} underruns`);
        }
        console.log(answered || (report.audioOut?.peakDuringPhrase ?? 0) > 0.01 ?
            `  ${mark(true)} agent answered the phrase ${report.phrase.join(' ')}` + (answered ?
                ` with ${report.agentNoteOns.join(' ')} (${report.agentNoteOffs} note-offs)` : ' with audio') :
            `  ${options.expectAnswer ? mark(false) : yellow('-')} agent played nothing in answer to the phrase`);
        console.log(`  ${mark(report.failedRequests.length === 0)} ${report.samplesLoaded} samples loaded, ${report.failedRequests.length} failed requests`);
        for (const f of report.failedRequests) console.log(`      ${f}`);
        console.log(`  ${mark(report.errors.length === 0)} ${report.errors.length} console errors`);
        for (const e of report.errors) console.log(`      ${e}`);
        for (const w of [...new Set(report.warnings)]) console.log(`  ${yellow('!')} ${w.replace(/^\[\w+\] warning: /, '')}`);
        if (flags.logs) console.log(report.logs.join('\n'));
        console.log(report.ok ? green('PASS') : red('FAIL'));
    }
    process.exit(report.ok ? 0 : 1);
}

function copyDir(from, to) {
    fs.mkdirSync(to, {recursive: true});
    for (const entry of fs.readdirSync(from, {withFileTypes: true})) {
        if (entry.name === 'node_modules') continue;
        const source = path.join(from, entry.name);
        if (entry.isDirectory()) copyDir(source, path.join(to, entry.name));
        else fs.copyFileSync(source, path.join(to, entry.name));
    }
}

function ejectCommand() {
    const pkgPath = path.resolve('package.json');
    if (!fs.existsSync(pkgPath)) fail('run eject in the project folder (no package.json here)');
    const dir = positional[0] ?? 'euterpe';
    const target = path.resolve(dir);
    if (fs.existsSync(target)) fail(`${dir} already exists`);
    if (target === PACKAGE_DIR) fail('Euterpe is already ejected here');
    copyDir(PACKAGE_DIR, target);
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    const version = JSON.parse(fs.readFileSync(path.join(PACKAGE_DIR, 'package.json'), 'utf8')).version;
    pkg.dependencies = {...pkg.dependencies, euterpe: `file:./${path.relative(process.cwd(), target)}`};
    fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
    console.log(`Copied Euterpe ${version} into ./${path.relative(process.cwd(), target)} and pointed package.json at it.`);
    console.log('Now run your package manager\'s install. Euterpe is part of your project: change it freely');
    console.log('(the UI is src/views/Euterpe.vue, the worker runtime src/worker/agentWorker.js, the plugin vite/index.js).');
    console.log(`To go back: set "euterpe": "^${version}" in package.json, delete the folder and install.`);
}

if (command === 'smoke') {
    smokeCommand().catch((error) => fail(error.message));
} else if (command === 'eject') {
    ejectCommand();
} else {
    console.log(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('*/')[0]
        .split('\n').filter((l) => l.startsWith(' * ')).map((l) => l.slice(3)).join('\n'));
    if (command && command !== 'help' && command !== '--help') process.exit(1);
}
