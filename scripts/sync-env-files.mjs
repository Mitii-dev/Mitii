#!/usr/bin/env node
import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';

const examplePath = resolve(process.cwd(), process.argv[2] ?? '.env.example');
const envPath = resolve(process.cwd(), process.argv[3] ?? '.env');

function parseKeys(path) {
  if (!existsSync(path)) return null;
  const keys = new Set();
  for (const rawLine of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const match = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/);
    if (match) keys.add(match[1]);
  }
  return keys;
}

const exampleKeys = parseKeys(examplePath);
if (!exampleKeys) {
  console.error(`Missing env template: ${examplePath}`);
  process.exit(2);
}

const envKeys = parseKeys(envPath) ?? new Set();
const missing = [...exampleKeys].filter((key) => !envKeys.has(key)).sort();
const extra = [...envKeys].filter((key) => !exampleKeys.has(key)).sort();

console.log(JSON.stringify({
  ok: missing.length === 0,
  example: examplePath,
  env: envPath,
  missing,
  extra,
}, null, 2));

process.exit(missing.length === 0 ? 0 : 1);
