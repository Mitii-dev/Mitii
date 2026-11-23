#!/usr/bin/env node
/**
 * Fail fast when a workspace package is typechecked/built before a dependency
 * has emitted dist/ (common Release failure: @mitii/host before @mitii/automation).
 *
 * Usage:
 *   node scripts/assert-workspace-dep-built.mjs <dep> [dep...] [from-package-dir]
 *   node scripts/assert-workspace-dep-built.mjs --from-package-json [from-package-dir]
 *
 * With --from-package-json, asserts every @mitii/* dependency listed in that
 * package.json (excluding the package itself).
 */
import { existsSync, lstatSync, readFileSync, readlinkSync, realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';

const rawArgs = process.argv.slice(2);
const usePackageJson = rawArgs.includes('--from-package-json');
const positional = rawArgs.filter((a) => a !== '--from-package-json');

let fromDir = process.cwd();
let depNames = [];

if (positional.length > 0) {
  const last = positional[positional.length - 1];
  if (last.startsWith('@') || last === '--from-package-json') {
    depNames = positional;
  } else if (existsSync(join(resolve(last), 'package.json'))) {
    fromDir = resolve(last);
    depNames = positional.slice(0, -1);
  } else {
    depNames = positional;
  }
}

fromDir = resolve(fromDir);

if (usePackageJson) {
  const pkg = JSON.parse(readFileSync(join(fromDir, 'package.json'), 'utf8'));
  const selfName = pkg.name;
  const deps = {
    ...(pkg.dependencies ?? {}),
    ...(pkg.optionalDependencies ?? {}),
  };
  depNames = Object.keys(deps)
    .filter((name) => name.startsWith('@mitii/') && name !== selfName)
    .sort();
}

if (depNames.length === 0) {
  console.error(
    'Usage: node scripts/assert-workspace-dep-built.mjs <@mitii/name>... [fromDir]',
  );
  console.error(
    '   or: node scripts/assert-workspace-dep-built.mjs --from-package-json [fromDir]',
  );
  process.exit(2);
}

function fail(depName, message, details = []) {
  console.error(`[assert-workspace-dep-built] ${message}`);
  for (const detail of details) console.error(`  ${detail}`);
  console.error(
    `  Fix: pnpm -r --filter ${depName}... run build   (or pnpm run build / build:vscode-deps)`,
  );
  process.exit(1);
}

function readPkg(packageJsonPath) {
  return JSON.parse(readFileSync(packageJsonPath, 'utf8'));
}

function findLinkedDepRoot(depName) {
  const linkPath = join(fromDir, 'node_modules', ...depName.split('/'));
  if (!existsSync(linkPath)) return undefined;
  try {
    const stat = lstatSync(linkPath);
    if (stat.isSymbolicLink()) {
      return resolve(dirname(linkPath), readlinkSync(linkPath));
    }
    return realpathSync(linkPath);
  } catch {
    return undefined;
  }
}

function findPackageRootFromEntry(entryPath, name) {
  let dir = dirname(entryPath);
  for (;;) {
    const candidate = join(dir, 'package.json');
    if (existsSync(candidate)) {
      try {
        const pkg = readPkg(candidate);
        if (pkg.name === name) return { root: dir, pkg };
      } catch {
        // keep walking
      }
    }
    const parent = dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

function assertDepBuilt(depName) {
  const requireFrom = createRequire(join(fromDir, 'package.json'));
  let found;

  try {
    const resolved = requireFrom.resolve(depName);
    found = findPackageRootFromEntry(resolved, depName);
  } catch {
    const linkedRoot = findLinkedDepRoot(depName);
    if (linkedRoot && existsSync(join(linkedRoot, 'package.json'))) {
      found = { root: linkedRoot, pkg: readPkg(join(linkedRoot, 'package.json')) };
    } else {
      fail(
        depName,
        `${depName} is not resolvable from ${fromDir} (missing link or dist).`,
      );
    }
  }

  if (!found) {
    fail(depName, `could not locate package root for ${depName}`);
  }

  const { root: depRoot, pkg } = found;
  const typesPath =
    typeof pkg.types === 'string'
      ? join(depRoot, pkg.types)
      : join(depRoot, 'dist', 'index.d.ts');
  const mainPath =
    typeof pkg.main === 'string'
      ? join(depRoot, pkg.main)
      : join(depRoot, 'dist', 'index.js');

  if (!existsSync(typesPath) || !existsSync(mainPath)) {
    fail(depName, `${depName} is linked but not built.`, [
      `expected types: ${typesPath}`,
      `expected main:  ${mainPath}`,
      `package root:   ${depRoot}`,
    ]);
  }
}

for (const depName of depNames) {
  assertDepBuilt(depName);
}
