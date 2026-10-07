#!/usr/bin/env node
/**
 * npm create euterpe@latest [directory] [-- --template <name>]
 *
 * Creates a Euterpe agent project from a template: the agent (agent/hooks.js and its YAML files), a Vite
 * config with euterpe/vite, and deploy configs with the cross-origin isolation headers.
 */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createInterface} from 'node:readline/promises';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(fs.readFileSync(path.join(HERE, 'package.json'), 'utf8'));
// the templates are bundled into the package when it is packed (prepack); in the Euterpe repo, use them directly
const TEMPLATES = fs.existsSync(path.join(HERE, 'templates')) ?
    path.join(HERE, 'templates') : path.resolve(HERE, '../../templates');

const TEMPLATE_INFO = {
    'empty': 'hooks that do nothing yet: start here',
    'copycat': 'copies your notes on the 16th-note grid, delayed and transposed',
    'call-response': 'waits for your phrase, then answers it in your rhythm',
};
const SKIP = new Set(['node_modules', 'dist', '.DS_Store']);

const bold = (s) => (process.stdout.isTTY ? `\x1b[1m${s}\x1b[22m` : s);
const fail = (message) => {
    console.error(`create-euterpe: ${message}`);
    process.exit(1);
};

function parseArgs(argv) {
    const args = {dir: null, template: null, force: false, help: false};
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a === '--template' || a === '-t') args.template = argv[++i];
        else if (a.startsWith('--template=')) args.template = a.split('=')[1];
        else if (a === '--force') args.force = true;
        else if (a === '--help' || a === '-h') args.help = true;
        else if (a.startsWith('-')) fail(`unknown option ${a}`);
        else args.dir = a;
    }
    return args;
}

// the bundled templates: the described ones first (empty is the default), then any others
function templates() {
    const names = fs.readdirSync(TEMPLATES).filter((name) =>
        !name.startsWith('_') && fs.existsSync(path.join(TEMPLATES, name, 'agent', 'hooks.js')));
    const order = Object.keys(TEMPLATE_INFO);
    const rank = (name) => (order.includes(name) ? order.indexOf(name) : order.length);
    return names.sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
}

function copyDir(from, to) {
    fs.mkdirSync(to, {recursive: true});
    for (const entry of fs.readdirSync(from, {withFileTypes: true})) {
        if (SKIP.has(entry.name)) continue;
        const source = path.join(from, entry.name);
        const target = path.join(to, entry.name);
        if (entry.isDirectory()) copyDir(source, target);
        else fs.copyFileSync(source, target);
    }
}

function packageName(dir) {
    return path.basename(path.resolve(dir)).toLowerCase().replace(/[^a-z0-9._~-]+/g, '-').replace(/^[._-]+/, '') ||
        'euterpe-agent';
}

function packageManager() {
    const agent = process.env.npm_config_user_agent ?? '';
    for (const pm of ['pnpm', 'yarn', 'bun']) if (agent.startsWith(pm)) return pm;
    return 'npm';
}

async function main() {
    const args = parseArgs(process.argv.slice(2));
    const available = templates();
    if (args.help) {
        console.log(`Usage: npm create euterpe@latest [directory] -- [--template <name>] [--force]\n\nTemplates:`);
        for (const name of available) console.log(`  ${name.padEnd(15)}${TEMPLATE_INFO[name] ?? ''}`);
        return;
    }
    const interactive = process.stdin.isTTY && process.stdout.isTTY;
    const rl = interactive ? createInterface({input: process.stdin, output: process.stdout}) : null;
    try {
        console.log(`\n${bold('Euterpe')}: a real-time interactive music agent in the browser\n`);
        let dir = args.dir;
        if (!dir) dir = (interactive ? (await rl.question('Project directory (my-agent): ')).trim() : '') || 'my-agent';

        let template = args.template;
        if (template && !available.includes(template)) {
            fail(`no template "${template}" (templates: ${available.join(', ')})`);
        }
        if (!template && interactive) {
            console.log('\nTemplates:');
            available.forEach((name, i) => console.log(`  ${i + 1}. ${name.padEnd(15)}${TEMPLATE_INFO[name] ?? ''}`));
            const answer = (await rl.question(`Template (1-${available.length} or a name, default 1): `)).trim();
            if (answer === '') template = available[0];
            else if (/^\d+$/.test(answer)) template = available[Number(answer) - 1];
            else template = available.find((name) => name === answer.toLowerCase());
            if (!template) fail(`no template "${answer}" (templates: ${available.join(', ')})`);
        }
        template ??= 'empty';

        const target = path.resolve(dir);
        if (fs.existsSync(target) && fs.readdirSync(target).length > 0 && !args.force) {
            fail(`${dir} exists and is not empty (use --force to write into it)`);
        }

        // the template, plus the files every project gets
        copyDir(path.join(TEMPLATES, template), target);
        fs.copyFileSync(path.join(TEMPLATES, '_shared', 'gitignore'), path.join(target, '.gitignore'));

        // package.json: the project's name, euterpe from npm (not the repo's workspace link)
        const projectPkgPath = path.join(target, 'package.json');
        const projectPkg = JSON.parse(fs.readFileSync(projectPkgPath, 'utf8'));
        projectPkg.name = packageName(dir);
        projectPkg.version = '0.0.0';
        delete projectPkg.license;
        projectPkg.dependencies.euterpe = `^${pkg.euterpeVersion ?? pkg.version}`;
        fs.writeFileSync(projectPkgPath, JSON.stringify(projectPkg, null, 2) + '\n');
        const indexPath = path.join(target, 'index.html');
        fs.writeFileSync(indexPath, fs.readFileSync(indexPath, 'utf8')
            .replace('<title>Euterpe agent</title>', `<title>${projectPkg.name}</title>`));

        const pm = packageManager();
        const cd = path.relative(process.cwd(), target);
        console.log(`\nCreated ${bold(cd || '.')} from the ${bold(template)} template.\n\nNext:`);
        if (cd) console.log(`  cd ${cd.includes(' ') ? JSON.stringify(cd) : cd}`);
        console.log(`  ${pm} install`);
        console.log(`  ${pm === 'npm' ? 'npm run dev' : `${pm} dev`}\n`);
        console.log('Your agent is agent/hooks.js; AGENTS.md describes the hooks.\n');
    } finally {
        rl?.close();
    }
}

main().catch((error) => fail(error.message));
