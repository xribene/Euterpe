// prepack: copies the repo's templates into the package (templates/<name> and templates/_shared/gitignore),
// and checks that euterpeVersion matches packages/euterpe.
import fs from 'node:fs';
import path from 'node:path';

const PACKAGE = path.resolve(import.meta.dirname, '..');
const REPO_TEMPLATES = path.resolve(PACKAGE, '../../templates');
const OUT = path.join(PACKAGE, 'templates');
const SKIP = new Set(['node_modules', 'dist', '.DS_Store']);

const pkg = JSON.parse(fs.readFileSync(path.join(PACKAGE, 'package.json'), 'utf8'));
const euterpe = JSON.parse(fs.readFileSync(path.resolve(PACKAGE, '../euterpe/package.json'), 'utf8'));
if (pkg.euterpeVersion !== euterpe.version) {
    throw new Error(`create-euterpe euterpeVersion ${pkg.euterpeVersion} != euterpe ${euterpe.version}`);
}

function copyDir(from, to) {
    fs.mkdirSync(to, {recursive: true});
    for (const entry of fs.readdirSync(from, {withFileTypes: true})) {
        if (SKIP.has(entry.name)) continue;
        const source = path.join(from, entry.name);
        if (entry.isDirectory()) copyDir(source, path.join(to, entry.name));
        else fs.copyFileSync(source, path.join(to, entry.name));
    }
}

fs.rmSync(OUT, {recursive: true, force: true});
for (const name of fs.readdirSync(REPO_TEMPLATES)) {
    const dir = path.join(REPO_TEMPLATES, name);
    if (name.startsWith('_') || !fs.statSync(dir).isDirectory()) continue;
    copyDir(dir, path.join(OUT, name));
}
fs.mkdirSync(path.join(OUT, '_shared'));
fs.copyFileSync(path.join(REPO_TEMPLATES, '_shared', 'gitignore'), path.join(OUT, '_shared', 'gitignore'));
console.log(`bundled templates: ${fs.readdirSync(OUT).filter((n) => !n.startsWith('_')).join(', ')}`);
