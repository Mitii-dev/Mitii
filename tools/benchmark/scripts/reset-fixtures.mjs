#!/usr/bin/env node
/**
 * Restore pinned benchmark fixtures after eval/benchmark runs.
 * Reverts tracked source changes and removes agent-created untracked files.
 */
import { spawnSync } from 'child_process';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

function run(command, args) {
  const result = spawnSync(command, args, { cwd: packageRoot, stdio: 'inherit' });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

console.log('Restoring pinned fixture sources from git...');
run('git', ['checkout', '--', 'tools/benchmark/fixtures/']);

console.log('Removing agent-created untracked files under fixtures...');
run('git', ['clean', '-fd', 'tools/benchmark/fixtures/']);

console.log('Restoring eval test task manifests (if modified by vitest)...');
run('git', ['checkout', '--', 'tools/benchmark/tasks/eval/generated-test/manifest.json']);
run('git', ['checkout', '--', 'tools/benchmark/tasks/eval/generated-test-full/manifest.json']);

console.log('Fixture reset complete.');
