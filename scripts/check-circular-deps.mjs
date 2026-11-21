#!/usr/bin/env node
/**
 * Circular dependency scan for Mitii product packages.
 *
 * Module-level cycles in V8 are enforced by
 * `packages/v8/tests/architecture/v8-module-cycles.test.ts`.
 * File-level cycles use a shrinking allowlist
 * (`scripts/circular-deps-allowlist.json`).
 * `packages/v8/src/engine` is excluded until engine layout debt is cleared.
 */
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { spawnSync } from 'child_process';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const writeAllowlist = process.argv.includes('--write-allowlist');
const pathArg = process.argv.slice(2).find((arg) => !arg.startsWith('--'));
const root = pathArg ? resolve(pathArg) : repoRoot;
const allowlistPath = resolve(repoRoot, 'scripts/circular-deps-allowlist.json');
const localMadge = resolve(root, 'node_modules/.bin/madge');
const command = existsSync(localMadge) ? localMadge : 'pnpm';

const SCAN_ROOTS = [
  'packages/v8/src/modules',
  'packages/sdk/src',
  'packages/host/src',
  'packages/ui-core/src',
  'packages/ui-protocol/src',
  'packages/ui-react/src',
  'packages/ui-theme',
  'packages/automation/src',
  'packages/search-kit/src',
  'apps/cli/src',
  'apps/desktop/src',
  'apps/vscode/src',
  'apps/vscode/webview-ui/src',
];

const exclude =
  'node_modules|dist|out|coverage|\\.git|\\.workspaces|tests/benchmark|reports|apps/desktop/release';

function cycleKey(scanRoot, cycle) {
  return `${scanRoot}::${cycle.join(' -> ')}`;
}

function loadAllowlist() {
  if (!existsSync(allowlistPath)) return new Set();
  const raw = JSON.parse(readFileSync(allowlistPath, 'utf8'));
  const entries = Array.isArray(raw) ? raw : (raw.cycles ?? []);
  return new Set(entries.map((e) => cycleKey(e.root, e.cycle)));
}

const found = [];

for (const scanRoot of SCAN_ROOTS) {
  const abs = resolve(root, scanRoot);
  if (!existsSync(abs)) continue;
  const args = existsSync(localMadge)
    ? [
        abs,
        '--circular',
        '--json',
        '--extensions',
        'ts,tsx,js,jsx,mjs,cjs',
        '--exclude',
        exclude,
      ]
    : [
        'dlx',
        'madge',
        abs,
        '--circular',
        '--json',
        '--extensions',
        'ts,tsx,js,jsx,mjs,cjs',
        '--exclude',
        exclude,
      ];

  const result = spawnSync(command, args, {
    cwd: root,
    encoding: 'utf8',
    shell: process.platform === 'win32',
  });

  if (result.error) {
    console.error(result.error.message);
    process.exit(2);
  }

  const stdout = result.stdout.trim();
  let cycles;
  try {
    cycles = stdout ? JSON.parse(stdout) : [];
  } catch {
    if (stdout) console.log(stdout);
    if (result.stderr) console.error(result.stderr);
    process.exit(result.status ?? 1);
  }

  if (!Array.isArray(cycles)) continue;
  for (const cycle of cycles) {
    if (!Array.isArray(cycle) || cycle.length === 0) continue;
    found.push({ root: scanRoot, cycle });
  }
}

found.sort((a, b) => cycleKey(a.root, a.cycle).localeCompare(cycleKey(b.root, b.cycle)));

if (writeAllowlist) {
  writeFileSync(
    allowlistPath,
    `${JSON.stringify(
      {
        note: 'Shrinking allowlist for file-level circular deps. Remove entries when cycles are broken. Do not add new cycles.',
        cycles: found,
      },
      null,
      2,
    )}\n`,
    'utf8',
  );
  console.log(`Wrote ${found.length} allowlisted cycles to scripts/circular-deps-allowlist.json`);
  process.exit(0);
}

const allowlist = loadAllowlist();
const newCycles = found.filter((c) => !allowlist.has(cycleKey(c.root, c.cycle)));
const stale = [...allowlist].filter(
  (key) => !found.some((c) => cycleKey(c.root, c.cycle) === key),
);

if (stale.length > 0) {
  console.warn(
    `circular-deps: ${stale.length} allowlist entries are resolved (refresh with --write-allowlist):\n` +
      stale.map((k) => `  - ${k}`).join('\n'),
  );
}

if (newCycles.length > 0) {
  console.error(
    `circular-deps: ${newCycles.length} new cycle(s) not allowlisted:\n` +
      JSON.stringify(newCycles, null, 2),
  );
  process.exit(1);
}

console.log(
  `circular-deps: ok (${found.length} allowlisted cycles; ${stale.length} stale; v8-engine excluded)`,
);
process.exit(0);
