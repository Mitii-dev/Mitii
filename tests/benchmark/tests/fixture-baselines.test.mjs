import test from 'node:test';
import assert from 'node:assert/strict';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadCases } from '../src/cases.mjs';
import { snapshotTree } from '../src/snapshot.mjs';
import { verifyCheck } from '../src/verifiers.mjs';

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const fileStateTypes = new Set([
  'file_exists',
  'file_not_exists',
  'file_contains',
  'file_not_contains',
  'dir_has_files',
]);

test('all case preconditions match their pinned fixture baselines', async () => {
  const cases = loadCases(rootDir);
  const snapshots = new Map();
  const failures = [];
  for (const testCase of cases) {
    const workspace = join(rootDir, 'fixtures', testCase.fixture);
    const snapshot = snapshots.get(testCase.fixture) ?? snapshotTree(workspace);
    snapshots.set(testCase.fixture, snapshot);
    for (const check of testCase.preconditions) {
      const checked = await verifyCheck(check, {
        output: '',
        agentExitCode: 0,
        workspace,
        before: snapshot,
        after: snapshot,
      });
      if (!checked.passed) failures.push(`${testCase.id}: ${check.type} ${check.path ?? ''}`);
    }
    if (testCase.mode !== 'agent') {
      for (const check of testCase.checks.filter((item) => fileStateTypes.has(item.type))) {
        const checked = await verifyCheck(check, {
          output: '',
          agentExitCode: 0,
          workspace,
          before: snapshot,
          after: snapshot,
        });
        if (!checked.passed) failures.push(`${testCase.id}: baseline ${check.type} ${check.path ?? ''}`);
      }
    }
  }
  assert.deepEqual(failures, []);
});
