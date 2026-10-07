/**
 * Checks the agent's YAML files against euterpe/schema/*.schema.json and a few rules the schema can't express.
 * Errors (missing keys, wrong types, unknown instruments) stop the dev server with an overlay and fail the
 * build; warnings (unknown keys, settings that leave a hook without input) are printed and shown in the
 * browser console.
 */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import AjvModule from 'ajv';

const Ajv = AjvModule.default ?? AjvModule;
const SCHEMA_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'schema');
const ajv = new Ajv({allErrors: true, strict: false, verbose: true});
const validators = Object.fromEntries(['config', 'widgets', 'players'].map((kind) => [kind,
    ajv.compile(JSON.parse(fs.readFileSync(path.join(SCHEMA_DIR, `${kind}.schema.json`), 'utf8')))]));

// '/gui/settingsModal/sliders/0' -> 'gui.settingsModal.sliders[0]'
const keyPath = (pointer) => pointer.split('/').slice(1).reduce((p, part) =>
    (/^\d+$/.test(part) ? `${p}[${part}]` : p ? `${p}.${part}` : part), '');

function distance(a, b) {
    const d = Array.from({length: a.length + 1}, (_, i) => [i, ...Array(b.length).fill(0)]);
    for (let j = 1; j <= b.length; j++) d[0][j] = j;
    for (let i = 1; i <= a.length; i++) {
        for (let j = 1; j <= b.length; j++) {
            d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
        }
    }
    return d[a.length][b.length];
}

function describe(error, data) {
    const where = keyPath(error.instancePath);
    const at = where ? `${where}: ` : '';
    const value = error.instancePath.split('/').slice(1).reduce((o, k) => o?.[k], data);
    switch (error.keyword) {
    case 'additionalProperties': {
        const key = error.params.additionalProperty;
        const known = Object.keys(error.parentSchema.properties ?? {});
        const close = known.filter((k) => distance(k.toLowerCase(), key.toLowerCase()) <= 2);
        const hint = close.length ? `; did you mean "${close[0]}"?` : known.length ? ` (known: ${known.join(', ')})` : '';
        return {warning: true, text: `${at}unknown key "${key}"${hint}`};
    }
    case 'required':
        return {text: `${at}missing "${error.params.missingProperty}"`};
    case 'enum':
        return {text: `${at}${JSON.stringify(value)} is not one of ${error.params.allowedValues.join(', ')}`};
    case 'type':
        return {text: `${at}must be ${[].concat(error.params.type).join(' or ')}, got ${JSON.stringify(value)}`};
    default:
        return {text: `${at}${error.message}`};
    }
}

/**
 * @param {Object<string, {file: string, data: Object}>} files - config, widgets, players (as loaded).
 * @return {{errors: string[], warnings: string[]}}
 */
export function validateAgent(files) {
    const errors = [];
    const warnings = [];
    for (const [kind, {file, data}] of Object.entries(files)) {
        if (!data) continue;
        if (!validators[kind](data)) {
            for (const error of validators[kind].errors) {
                const {warning, text} = describe(error, data);
                (warning ? warnings : errors).push(`${file}: ${text}`);
            }
        }
    }
    // what the schema can't say
    const config = files.config?.data ?? {};
    const file = files.config?.file ?? 'config.yaml';
    const grid = config.noteModeSettings?.gridBased ?? {};
    const event = config.noteModeSettings?.eventBased ?? {};
    if (grid.status && !grid.quantizedEvents && !grid.eventBuffer && !event.status && !config.interactionMode?.audioMode) {
        warnings.push(`${file}: gridBased is on but quantizedEvents and eventBuffer are off, so processClockEvent ` +
            'never sees the user\'s notes');
    }
    const am = config.audioModeSettings ?? {};
    if (am.hopSize && am.windowSize && am.hopSize > am.windowSize) {
        errors.push(`${file}: audioModeSettings.hopSize (${am.hopSize}) is larger than windowSize (${am.windowSize})`);
    }
    if (config.audioOutSettings && !config.interactionMode?.audioOut) {
        warnings.push(`${file}: audioOutSettings is set but interactionMode.audioOut is not true, so the agent has no audio output`);
    }
    if (!grid.status && !event.status && !config.interactionMode?.audioMode) {
        warnings.push(`${file}: gridBased, eventBased and audioMode are all off, so the agent's hooks get no input`);
    }
    const modal = files.widgets?.data?.gui?.settingsModal ?? {};
    for (const kind of ['sliders', 'switches', 'buttons', 'dropdowns']) {
        const ids = (modal[kind] ?? []).map((w, i) => w?.id ?? (kind === 'sliders' || kind === 'switches' ? i + 1 : undefined));
        const dup = ids.find((id, i) => id !== undefined && ids.indexOf(id) !== i);
        if (dup !== undefined) errors.push(`${files.widgets.file}: gui.settingsModal.${kind}: two widgets with id ${dup}`);
    }
    for (const [i, s] of (files.widgets?.data?.gui?.settingsModal?.switches ?? []).entries()) {
        if (s && 'value' in s && !('status' in s)) {
            warnings.push(`${files.widgets.file}: gui.settingsModal.switches[${i}]: switches use "status", not "value"`);
        }
    }
    return {errors, warnings};
}
