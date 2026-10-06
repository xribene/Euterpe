// Copies the files every template shares (templates/_shared) into each template, so they stay identical.
//   node tools/sync-templates.mjs          write
//   node tools/sync-templates.mjs --check  exit 1 if a template differs (CI)
import fs from 'node:fs';
import path from 'node:path';

const TEMPLATES = path.resolve(import.meta.dirname, '../templates');
const SHARED = path.join(TEMPLATES, '_shared');
// gitignore is written by create-euterpe as .gitignore (npm drops .gitignore files from packages)
const FILES = ['index.html', 'vite.config.js', 'netlify.toml', 'vercel.json', 'public/favicon.svg'];
const check = process.argv.includes('--check');

let differ = 0;
for (const name of fs.readdirSync(TEMPLATES)) {
    const dir = path.join(TEMPLATES, name);
    if (name.startsWith('_') || !fs.statSync(dir).isDirectory()) continue;
    for (const file of FILES) {
        const source = fs.readFileSync(path.join(SHARED, file));
        const target = path.join(dir, file);
        if (fs.existsSync(target) && fs.readFileSync(target).equals(source)) continue;
        differ++;
        if (check) {
            console.error(`templates/${name}/${file} differs from templates/_shared/${file}`);
        } else {
            fs.mkdirSync(path.dirname(target), {recursive: true});
            fs.writeFileSync(target, source);
            console.log(`wrote templates/${name}/${file}`);
        }
    }
}
if (check && differ) process.exit(1);
