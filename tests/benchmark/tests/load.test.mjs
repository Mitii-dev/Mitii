import test from 'node:test';
import assert from 'node:assert/strict';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadCases } from '../src/cases.mjs';
import { validateSuite } from '../src/validate.mjs';

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');

test('suite contains exactly 500 cases per difficulty', () => {
  const cases = loadCases(rootDir);
  const validation = validateSuite(cases, rootDir);
  assert.equal(validation.valid, true, validation.errors.join('\n'));
  assert.deepEqual(validation.counts, { easy: 500, medium: 500, hard: 500 });
  assert.equal(validation.uniqueIds, 1500);
});
