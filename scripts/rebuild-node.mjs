#!/usr/bin/env node
/**
 * Rebuild native modules for system Node.js.
 * Required for headless CLI eval and Vitest — distinct from Electron (rebuild:native).
 * Targets better-sqlite3 from @mitii/v8.
 */
import { spawnSync } from 'child_process';
import { createRequire } from 'module';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const v8PackageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../packages/v8');
const require = createRequire(resolve(v8PackageRoot, 'package.json'));

const MODULES = ['better-sqlite3'];

function moduleDir(name) {
  return require.resolve(`${name}/package.json`).replace(/package\.json$/, '');
}

function rebuildModule(name) {
  const dir = moduleDir(name);
  console.log(`Rebuilding ${name} for Node ${process.version}…`);
  const result = spawnSync(
    'pnpm',
    ['exec', 'node-gyp', 'rebuild', `--directory=${dir}`],
    { cwd: v8PackageRoot, stdio: 'inherit', shell: process.platform === 'win32' }
  );
  return result.status === 0;
}

function main() {
  for (const name of MODULES) {
    if (!rebuildModule(name)) {
      console.error(`\nRebuild failed for ${name}.`);
      process.exit(1);
    }
  }
  console.log('\nNative rebuild complete for system Node.');
  console.log('Run pnpm run rebuild:native before F5 if the VS Code extension fails to load native modules.');
}

main();
