#!/usr/bin/env node
/**
 * Rebuild native modules for system Node.js.
 * Required for headless CLI eval and Vitest — distinct from Electron (rebuild:native).
 * Targets better-sqlite3 from @mitii/v8.
 *
 * After `rebuild:native`, this is also run automatically so node_modules stays
 * Node-ABI while Electron's binding remains staged under apps/vscode/dist/native.
 */
import { spawnSync } from 'child_process';
import { createRequire } from 'module';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const v8PackageRoot = resolve(repoRoot, 'packages/v8');
const require = createRequire(resolve(v8PackageRoot, 'package.json'));

const MODULES = ['better-sqlite3'];

function moduleDir(name) {
  return require.resolve(`${name}/package.json`).replace(/package\.json$/, '');
}

export function rebuildForNode() {
  for (const name of MODULES) {
    const dir = moduleDir(name);
    console.log(`Rebuilding ${name} for Node ${process.version}…`);
    const result = spawnSync(
      'pnpm',
      ['exec', 'node-gyp', 'rebuild', `--directory=${dir}`],
      { cwd: v8PackageRoot, stdio: 'inherit', shell: process.platform === 'win32' },
    );
    if (result.status !== 0) {
      return false;
    }
  }
  return true;
}

function main() {
  if (!rebuildForNode()) {
    console.error('\nRebuild failed for better-sqlite3.');
    process.exit(1);
  }
  console.log('\nNative rebuild complete for system Node.');
  console.log(
    'Electron F5 uses apps/vscode/dist/native — run `pnpm run rebuild:native` if that binding is missing.',
  );
}

const isMain =
  process.argv[1] &&
  resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1]);

if (isMain) {
  main();
}
