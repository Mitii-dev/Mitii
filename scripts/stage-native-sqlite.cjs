#!/usr/bin/env node
/**
 * Stage better-sqlite3's compiled .node into apps/vscode/dist/native.
 * Used by the VS Code extension build and rebuild:native so F5 always
 * loads the Electron ABI binding, not a stale Node-built copy.
 */
const { copyFileSync, existsSync, mkdirSync, readdirSync } = require('node:fs');
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
    const requireFromV8 = createRequire(
      join(repoRoot, 'packages', 'v8', 'package.json'),
    );
    return dirname(requireFromV8.resolve('better-sqlite3/package.json'));
  }
}

function findNativeBinding(betterSqliteRoot) {
  const binRoot = join(betterSqliteRoot, 'bin');
  const binCandidates = [];
  const explicitAbi = process.env.MITII_ELECTRON_ABI;
  if (explicitAbi) {
    binCandidates.push(
      join(
        binRoot,
        `${process.platform}-${process.arch}-${explicitAbi}`,
        'better-sqlite3.node',
      ),
    );
  }

  if (existsSync(binRoot)) {
    const prefix = `${process.platform}-${process.arch}-`;
    const abiDirs = readdirSync(binRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && entry.name.startsWith(prefix))
      .map((entry) => ({
        name: entry.name,
        abi: Number(entry.name.slice(prefix.length)),
      }))
      .filter((entry) => Number.isFinite(entry.abi))
      // Prefer Electron ABI folders over the current terminal Node ABI.
      .sort((a, b) => {
        const current = Number(process.versions.modules);
        if (a.abi === current && b.abi !== current) return 1;
        if (b.abi === current && a.abi !== current) return -1;
        return b.abi - a.abi;
      });

    for (const entry of abiDirs) {
      binCandidates.push(join(binRoot, entry.name, 'better-sqlite3.node'));
    }
  }

  const candidates = [
    ...binCandidates,
    join(betterSqliteRoot, 'build', 'Release', 'better_sqlite3.node'),
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
  console.log(`staged native SQLite binding ${source} -> ${target}`);
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
