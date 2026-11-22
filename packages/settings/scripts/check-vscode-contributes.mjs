#!/usr/bin/env node
/**
 * Verify apps/vscode/package.json `contributes.configuration.properties`
 * (mitii.* keys) matches the @mitii/settings catalog.
 *
 * Usage:
 *   node packages/settings/scripts/check-vscode-contributes.mjs
 *   node packages/settings/scripts/check-vscode-contributes.mjs --write
 *   node packages/settings/scripts/check-vscode-contributes.mjs --manifest <path>
 *
 * Catalog-owned fields: type, default, description, enum, minimum, maximum.
 * Other manifest fields (scope, enumDescriptions, …) are left untouched.
 * A catalog default of null is "unset" and must be absent from the manifest.
 * `--write` adds missing keys, updates drifted fields, and removes extra
 * mitii.* keys; the catalog is the single source of truth.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const catalogPath = resolve(here, '../src/data/catalog.json');
const args = process.argv.slice(2);
const write = args.includes('--write');
const manifestFlag = args.indexOf('--manifest');
const manifestPath =
  manifestFlag >= 0 && args[manifestFlag + 1]
    ? resolve(args[manifestFlag + 1])
    : resolve(here, '../../../apps/vscode/package.json');

const OWNED = ['type', 'default', 'description', 'enum', 'minimum', 'maximum'];
const PREFIX = 'mitii.';

function stable(value) {
  return JSON.stringify(value, (_k, v) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)))
      : v,
  );
}

/** Catalog entry → owned manifest fields (null default omitted). */
function expectedFields(entry) {
  const out = {};
  for (const field of OWNED) {
    if (entry[field] === undefined) continue;
    if (field === 'default' && entry[field] === null) continue;
    out[field] = entry[field];
  }
  return out;
}

const catalog = JSON.parse(readFileSync(catalogPath, 'utf8'));
const manifestText = readFileSync(manifestPath, 'utf8');
const manifest = JSON.parse(manifestText);
const configuration = manifest?.contributes?.configuration;
if (!configuration || typeof configuration.properties !== 'object' || Array.isArray(configuration)) {
  console.error(`check-vscode-contributes: ${manifestPath} has no contributes.configuration.properties object`);
  process.exit(2);
}
const properties = configuration.properties;

const missing = [];
const extra = [];
const changed = [];

for (const [key, entry] of Object.entries(catalog)) {
  const want = expectedFields(entry);
  const have = properties[key];
  if (!have) {
    missing.push(key);
    continue;
  }
  const fields = OWNED.filter((field) => stable(want[field]) !== stable(have[field]));
  if (fields.length > 0) changed.push({ key, fields });
}
for (const key of Object.keys(properties)) {
  if (key.startsWith(PREFIX) && !(key in catalog)) extra.push(key);
}

const drifted = missing.length + extra.length + changed.length;

if (drifted === 0) {
  console.log(`check-vscode-contributes: OK (${Object.keys(catalog).length} mitii.* keys in sync)`);
  process.exit(0);
}

for (const key of missing) console.error(`missing in package.json: ${key}`);
for (const key of extra) console.error(`extra in package.json:   ${key}`);
for (const { key, fields } of changed) console.error(`changed: ${key} [${fields.join(', ')}]`);

if (!write) {
  console.error(
    `check-vscode-contributes: ${drifted} drift(s). Re-run with --write to patch ${manifestPath}`,
  );
  process.exit(1);
}

for (const key of extra) delete properties[key];
for (const key of [...missing, ...changed.map((c) => c.key)]) {
  const next = properties[key] ?? {};
  for (const field of OWNED) delete next[field];
  properties[key] = { ...expectedFields(catalog[key]), ...next };
}

const trailingNewline = manifestText.endsWith('\n') ? '\n' : '';
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}${trailingNewline}`);
console.log(`check-vscode-contributes: patched ${drifted} drift(s) in ${manifestPath}`);
