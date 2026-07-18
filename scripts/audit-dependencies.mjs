#!/usr/bin/env node
/**
 * Unused-dependency audit via depcheck across monorepo package roots.
 * Not a CVE scanner — use audit-vulnerabilities.mjs for security advisories.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ignores = [
  '@babel/*',
  '@vitejs/*',
  '@types/*',
  'electron',
  'electron-builder',
  'eslint*',
  'prettier',
  'typescript',
  'vite',
  'vitest',
  'react',
  'react-dom',
];

const cwd = process.cwd();
const skipDirs = new Set(['node_modules', '.git', '.mitii', 'dist', 'build', 'coverage', '.next', 'out']);

function findPackageRoots(root) {
  const roots = [];

  function walk(dir, depth) {
    const pkgPath = join(dir, 'package.json');
    if (existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
        const hasDeps =
          (pkg.dependencies && Object.keys(pkg.dependencies).length > 0) ||
          (pkg.devDependencies && Object.keys(pkg.devDependencies).length > 0);
        if (hasDeps) roots.push(dir);
      } catch {
        roots.push(dir);
      }
    }
    if (depth >= 3) return;
    let entries;
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const entry of entries) {
      if (skipDirs.has(entry) || entry.startsWith('.')) continue;
      const abs = join(dir, entry);
      try {
        if (statSync(abs).isDirectory()) walk(abs, depth + 1);
      } catch {
        // ignore
      }
    }
  }

  walk(root, 0);
  return roots.length > 0 ? roots : [root];
}

function resolveDepcheck() {
  const localBin =
    process.platform === 'win32' ? 'node_modules\\.bin\\depcheck.cmd' : 'node_modules/.bin/depcheck';
  if (existsSync(join(cwd, localBin)) || existsSync(localBin)) {
    return { command: existsSync(localBin) ? localBin : join(cwd, localBin), args: [] };
  }
  return { command: 'pnpm', args: ['dlx', 'depcheck'] };
}

function runDepcheck(dir) {
  const { command, args: baseArgs } = resolveDepcheck();
  const args = [...baseArgs, '--json', `--ignores=${ignores.join(',')}`];
  const result = spawnSync(command, args, {
    cwd: dir,
    encoding: 'utf8',
    shell: false,
    env: { ...process.env, FORCE_COLOR: '0' },
    timeout: 120_000,
    maxBuffer: 8 * 1024 * 1024,
  });

  const stdout = (result.stdout || '').trim();
  let parsed = null;
  if (stdout) {
    try {
      parsed = JSON.parse(stdout);
    } catch {
      // keep raw
    }
  }

  const unusedDeps = parsed?.dependencies ?? [];
  const unusedDevDeps = parsed?.devDependencies ?? [];
  const missing = parsed?.missing ?? {};

  return {
    packageRoot: relative(cwd, dir) || '.',
    exitCode: result.status ?? 1,
    error: result.error?.message,
    stderr: (result.stderr || '').trim().slice(0, 1500),
    unusedDependencies: unusedDeps,
    unusedDevDependencies: unusedDevDeps,
    missing,
    counts: {
      unusedDependencies: Array.isArray(unusedDeps) ? unusedDeps.length : 0,
      unusedDevDependencies: Array.isArray(unusedDevDeps) ? unusedDevDeps.length : 0,
      missing: missing && typeof missing === 'object' ? Object.keys(missing).length : 0,
    },
    raw: parsed ? undefined : stdout.slice(0, 4000),
  };
}

const roots = findPackageRoots(cwd).slice(0, 8);
const results = roots.map((dir) => runDepcheck(dir));
const totalUnused = results.reduce(
  (n, r) => n + (r.counts?.unusedDependencies ?? 0) + (r.counts?.unusedDevDependencies ?? 0),
  0
);

const output = {
  ok: true,
  kind: 'unused-dependency-audit',
  note:
    'This script reports UNUSED dependencies (depcheck), not CVEs. For vulnerability/CVE scanning use audit-vulnerabilities.mjs or `pnpm/npm audit`.',
  workspace: cwd,
  scannedRoots: roots.map((d) => relative(cwd, d) || '.'),
  totals: { unusedAcrossPackages: totalUnused },
  packages: results,
  emptyMeansClean:
    totalUnused === 0
      ? 'No unused dependencies detected in scanned package roots. This does NOT mean there are zero vulnerabilities.'
      : undefined,
};

process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
process.exit(0);
