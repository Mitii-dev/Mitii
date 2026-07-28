#!/usr/bin/env node
/**
 * Stage better-sqlite3's compiled .node into apps/vscode/dist/native.
 * Used by the VS Code extension build and rebuild:native so F5 always
 * loads the Electron ABI binding, not a stale Node-built copy.
 */
const { copyFileSync, existsSync, mkdirSync } = require('node:fs');
const { createRequire } = require('node:module');
const { dirname, join, resolve } = require('node:path');

const repoRoot = resolve(__dirname, '..');
const vscodeRoot = join(repoRoot, 'apps', 'vscode');
const distNativeDir = join(vscodeRoot, 'dist', 'native');
const target = join(distNativeDir, 'better_sqlite3.node');

function resolveBetterSqliteRoot() {
  const requireFromVscode = createRequire(join(vscodeRoot, 'package.json'));
  try {
    return dirname(requireFromVscode.resolve('better-sqlite3/package.json'));
  } catch {
    const requireFromV8 = createRequire(join(repoRoot, 'packages', 'v8', 'package.json'));
    return dirname(requireFromV8.resolve('better-sqlite3/package.json'));
  }
}

function findNativeBinding(betterSqliteRoot) {
  const candidates = [
    join(betterSqliteRoot, 'build', 'Release', 'better_sqlite3.node'),
    join(
      betterSqliteRoot,
      'bin',
      `${process.platform}-${process.arch}-${process.versions.modules}`,
      'better-sqlite3.node',
    ),
  ];
  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

function stageNativeSqliteBinding(options = {}) {
  const createDist = options.createDist !== false;
  const distDir = join(vscodeRoot, 'dist');

  if (!existsSync(distDir)) {
    if (!createDist) {
      console.log('Skipping native SQLite staging (apps/vscode/dist not present yet).');
      return null;
    }
    mkdirSync(distDir, { recursive: true });
  }

  const betterSqliteRoot = resolveBetterSqliteRoot();
  const source = findNativeBinding(betterSqliteRoot);
  if (!source) {
    throw new Error(
      `Could not find a better-sqlite3 native binding under ${betterSqliteRoot}. ` +
        'Run `pnpm run rebuild:native` (F5) or `pnpm run rebuild:node` (tests) first.',
    );
  }

  mkdirSync(distNativeDir, { recursive: true });
  copyFileSync(source, target);
  console.log(`staged native SQLite binding ${target}`);
  return target;
}

module.exports = {
  distNativeDir,
  stageNativeSqliteBinding,
  target,
};

if (require.main === module) {
  try {
    stageNativeSqliteBinding({ createDist: process.argv.includes('--create-dist') });
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
