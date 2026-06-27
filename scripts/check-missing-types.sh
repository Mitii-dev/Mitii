#!/usr/bin/env bash
set -euo pipefail

ROOT="${1:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}"
cd "$ROOT"

node <<'NODE'
const { existsSync, readFileSync } = require('fs');
const { join } = require('path');

const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const deps = Object.keys({
  ...(pkg.dependencies ?? {}),
  ...(pkg.optionalDependencies ?? {}),
  ...(pkg.peerDependencies ?? {}),
}).filter((name) => !name.startsWith('@types/'));
const devDeps = new Set(Object.keys(pkg.devDependencies ?? {}));

function typesPackageName(name) {
  if (name.startsWith('@')) {
    const [scope, packageName] = name.slice(1).split('/');
    return `@types/${scope}__${packageName}`;
  }
  return `@types/${name}`;
}

function hasBundledTypes(name) {
  const manifest = join('node_modules', name, 'package.json');
  if (!existsSync(manifest)) return false;
  try {
    const depPkg = JSON.parse(readFileSync(manifest, 'utf8'));
    return Boolean(
      depPkg.types ||
      depPkg.typings ||
      hasNestedTypesExport(depPkg.exports) ||
      existsSync(join('node_modules', name, 'index.d.ts'))
    );
  } catch {
    return false;
  }
}

function hasNestedTypesExport(value) {
  if (!value || typeof value !== 'object') return false;
  if (typeof value.types === 'string') return true;
  return Object.values(value).some(hasNestedTypesExport);
}

const missing = deps
  .map((name) => ({ name, typesPackage: typesPackageName(name) }))
  .filter(({ name, typesPackage }) => !devDeps.has(typesPackage) && !hasBundledTypes(name));

if (missing.length === 0) {
  console.log('No likely missing @types packages found.');
  process.exit(0);
}

console.log(JSON.stringify({ likelyMissingTypes: missing }, null, 2));
process.exit(1);
NODE
