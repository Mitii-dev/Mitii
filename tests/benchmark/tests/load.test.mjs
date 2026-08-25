import test from 'node:test';
import assert from 'node:assert/strict';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DOMAINS, loadCases, listSuites, loadSuiteManifest } from '../src/cases.mjs';
import { validateSuite } from '../src/validate.mjs';

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');

test('domains are frontend, backend, cicd, testing', () => {
  assert.deepEqual(listSuites(rootDir), [...DOMAINS]);
});

test('each domain has easy/medium/hard case files and matching counts', () => {
  for (const domain of DOMAINS) {
    const manifest = loadSuiteManifest(rootDir, domain);
    assert.deepEqual(manifest.caseFiles, ['easy.jsonl', 'medium.jsonl', 'hard.jsonl']);
    const cases = loadCases(rootDir, { suite: domain });
    const validation = validateSuite(cases, rootDir, { suite: domain });
    assert.equal(validation.valid, true, `${domain}: ${validation.errors.join('\n')}`);
    assert.equal(cases.length, manifest.expectedCounts.total);
    assert.equal(
      cases.filter((c) => c.difficulty === 'easy').length,
      manifest.expectedCounts.easy
    );
    assert.equal(
      cases.filter((c) => c.difficulty === 'medium').length,
      manifest.expectedCounts.medium
    );
    assert.equal(
      cases.filter((c) => c.difficulty === 'hard').length,
      manifest.expectedCounts.hard
    );
    assert.equal(cases.every((c) => c.suite === domain), true);
  }
});

test('combined domains validate with unique ids', () => {
  const cases = loadCases(rootDir, { suite: 'all' });
  const validation = validateSuite(cases, rootDir, { suite: 'all' });
  assert.equal(validation.valid, true, validation.errors.join('\n'));
  assert.equal(validation.uniqueIds, cases.length);
  assert.equal(Object.keys(validation.bySuite).sort().join(','), DOMAINS.slice().sort().join(','));
});
