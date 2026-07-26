#!/usr/bin/env node
import { existsSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runProcess } from '../src/process.mjs';

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const fixturesDir = join(rootDir, 'fixtures');
const fixtures = readdirSync(fixturesDir)
  .filter((name) => existsSync(join(fixturesDir, name, 'package.json')))
  .sort();

for (const fixture of fixtures) {
  const cwd = join(fixturesDir, fixture);
  const pnpm = existsSync(join(cwd, 'pnpm-lock.yaml'));
  const command = pnpm ? 'pnpm install --frozen-lockfile' : 'npm install --ignore-scripts';
  process.stdout.write(`Installing ${fixture} with ${pnpm ? 'pnpm' : 'npm'}... `);
  const result = await runProcess({ command, cwd, shell: true, timeoutMs: 300000 });
  if (result.exitCode !== 0) {
    console.error('FAILED');
    console.error((result.stderr || result.stdout).slice(0, 2000));
    process.exit(1);
  }
  console.log('done');
}
