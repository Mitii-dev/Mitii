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
  return dirname(require.resolve(`${name}/package.json`));
}

function run(command, args, cwd) {
  return spawnSync(command, args, {
    cwd,
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: process.env,
  });
}

export function rebuildForNode() {
  for (const name of MODULES) {
    const dir = moduleDir(name);
    console.log(`Rebuilding ${name} for Node ${process.version}…`);

    // Prefer the package install script (prebuild-install, then compile).
    const install = run(
      'npm',
      ['run', 'install', '--ignore-scripts=false'],
      dir,
    );
    if (install.status === 0) {
      continue;
    }

    console.warn(
      `${name} install script failed — falling back to node-gyp rebuild…`,
    );
    const gyp = run(
      'pnpm',
      ['exec', 'node-gyp', 'rebuild', `--directory=${dir}`],
      repoRoot,
    );
    if (gyp.status !== 0) {
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
