// Generates types/config.d.ts from schema/*.schema.json, so the YAML schemas and ctx.config's type never drift.
//   pnpm --filter euterpe gen-types
import fs from 'node:fs';
import path from 'node:path';
import {compile} from 'json-schema-to-typescript';

const PACKAGE = path.resolve(import.meta.dirname, '..');
const NAMES = {config: 'ConfigYaml', widgets: 'WidgetsYaml', players: 'PlayersYaml'};
let out = '// Generated from schema/*.schema.json by scripts/gen-config-types.mjs. Do not edit.\n\n';
for (const [kind, name] of Object.entries(NAMES)) {
    const schema = JSON.parse(fs.readFileSync(path.join(PACKAGE, 'schema', `${kind}.schema.json`), 'utf8'));
    schema.title = name;
    out += await compile(schema, name, {bannerComment: '', additionalProperties: false, cwd: path.join(PACKAGE, 'schema')});
    out += '\n';
}
out += '/** The agent\'s configuration: config.yaml, players.yaml and widgets.yaml merged (ctx.config). */\n';
out += 'export type Config = ConfigYaml & PlayersYaml & WidgetsYaml;\n';
fs.writeFileSync(path.join(PACKAGE, 'types', 'config.d.ts'), out);
console.log(`wrote types/config.d.ts (${out.split('\n').length} lines)`);
