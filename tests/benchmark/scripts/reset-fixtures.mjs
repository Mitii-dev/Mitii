#!/usr/bin/env node
/**
 * Wipe install/build artifacts under fixtures/, remove leftover case
 * workspaces from prior runs, then reinstall every fixture.
 *
 * Removes:
 * - fixture node_modules / dist / .next / coverage / .mitii
 * - package-lock.json / pnpm-lock.yaml / yarn.lock
 * - in-repo case workspaces: tests/benchmark/.workspaces/
 * - legacy OS temp leftovers: ${TMPDIR}/mitii-solid-benchmark/ (older runs)
 * - (optional) --reports → tests/benchmark/reports/
 *
 * Fixture *source* files stay as committed (or your local edits). Agent edits
 * from a run live under .workspaces/, not in fixtures/ copies.
 */
import { existsSync, readFileSync, readdirSync, rmSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runProcess } from '../src/process.mjs';
import { needsNativeRebuild } from './native-rebuild-deps.mjs';

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const fixturesDir = join(rootDir, 'fixtures');
const reportsDir = join(rootDir, 'reports');
const projectWorkRoot = join(rootDir, '.workspaces');
const legacyTempWorkRoot = join(tmpdir(), 'mitii-solid-benchmark');

const argv = new Set(process.argv.slice(2));
const cleanReports = argv.has('--reports');

const LOCKFILE_NAMES = new Set([
  'package-lock.json',
  'pnpm-lock.yaml',
  'yarn.lock',
]);
const ARTIFACT_DIRS = new Set([
  'node_modules',
  'dist',
  '.next',
  'coverage',
  '.mitii',
]);

function listFixtureRoots() {
  if (!existsSync(fixturesDir)) {
    return [];
  }
  return readdirSync(fixturesDir)
    .filter((name) => existsSync(join(fixturesDir, name, 'package.json')))
    .sort()
    .map((name) => join(fixturesDir, name));
}

function cleanTree(directory) {
  let removedDirs = 0;
  let removedLocks = 0;

  function visit(current) {
    let entries;
    try {
      entries = readdirSync(current, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) {
        if (ARTIFACT_DIRS.has(entry.name)) {
          rmSync(full, { recursive: true, force: true });
          removedDirs += 1;
          continue;
        }
        if (entry.name === '.git') {
          continue;
        }
        visit(full);
        continue;
      }
      if (entry.isFile() && LOCKFILE_NAMES.has(entry.name)) {
        unlinkSync(full);
        removedLocks += 1;
      }
    }
  }

  visit(directory);
  return { removedDirs, removedLocks };
}

function removePath(label, target) {
  if (!existsSync(target)) {
    console.log(`  skip ${label} (not present): ${target}`);
    return;
  }
  rmSync(target, { recursive: true, force: true });
  console.log(`  removed ${label}: ${target}`);
}

const fixtures = listFixtureRoots();
if (fixtures.length === 0) {
  console.error(`No fixtures with package.json under ${fixturesDir}`);
  process.exit(1);
}

console.log(`Resetting ${fixtures.length} fixture(s)...`);
let totalDirs = 0;
let totalLocks = 0;
for (const fixtureRoot of fixtures) {
  const name = fixtureRoot.slice(fixturesDir.length + 1);
  const { removedDirs, removedLocks } = cleanTree(fixtureRoot);
  totalDirs += removedDirs;
  totalLocks += removedLocks;
  console.log(
    `  cleaned ${name} (dirs=${removedDirs}, lockfiles=${removedLocks})`,
  );
}

console.log('Removing leftover run workspaces...');
removePath('project workspaces', projectWorkRoot);
removePath('legacy OS temp workspaces', legacyTempWorkRoot);
if (cleanReports) {
  removePath('reports', reportsDir);
} else {
  console.log(
    `  keep reports (pass --reports to delete): ${reportsDir}`,
  );
}

console.log(
  `Cleanup done (dirs=${totalDirs}, lockfiles=${totalLocks}). Reinstalling...`,
);

for (const fixtureRoot of fixtures) {
  const name = fixtureRoot.slice(fixturesDir.length + 1);
  const hasPnpmLock = existsSync(join(fixtureRoot, 'pnpm-lock.yaml'));
  const isPnpmWorkspace = existsSync(join(fixtureRoot, 'pnpm-workspace.yaml'));
  const usePnpm = hasPnpmLock || isPnpmWorkspace;
  const command = usePnpm
    ? hasPnpmLock
      ? 'pnpm install --frozen-lockfile'
      : 'pnpm install'
    : 'npm install --ignore-scripts';
  process.stdout.write(
    `Installing ${name} with ${usePnpm ? 'pnpm' : 'npm'}... `,
  );
  const result = await runProcess({
    command,
    cwd: fixtureRoot,
    shell: true,
    timeoutMs: 300_000,
  });
  if (result.exitCode !== 0) {
    console.error('FAILED');
    console.error((result.stderr || result.stdout).slice(0, 2000));
    process.exit(1);
  }
  console.log('done');

  if (!usePnpm) {
    const manifest = JSON.parse(readFileSync(join(fixtureRoot, 'package.json'), 'utf8'));
    const toRebuild = needsNativeRebuild(manifest);
    if (toRebuild.length > 0) {
      process.stdout.write(`  rebuilding native deps for ${name} (${toRebuild.join(', ')})... `);
      const rebuild = await runProcess({
        command: `npm rebuild ${toRebuild.join(' ')}`,
        cwd: fixtureRoot,
        shell: true,
        timeoutMs: 300_000,
      });
      if (rebuild.exitCode !== 0) {
        console.error('FAILED');
        console.error((rebuild.stderr || rebuild.stdout).slice(0, 2000));
        process.exit(1);
      }
      console.log('done');
    }
  }
}

console.log('Fixture reset complete.');
