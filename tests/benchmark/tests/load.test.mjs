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

test('each domain validates against suite.json counts and caseFiles', () => {
  for (const domain of DOMAINS) {
    const manifest = loadSuiteManifest(rootDir, domain);
    assert.ok(Array.isArray(manifest.caseFiles) && manifest.caseFiles.length > 0);
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

test('frontend core is agent-only with expected capability mix', () => {
  const cases = loadCases(rootDir, { suite: 'frontend' });
  assert.equal(cases.length, 86);
  assert.equal(cases.every((c) => c.mode === 'agent'), true);
  const byCap = Object.fromEntries(
    ['feature', 'bugfix', 'docs', 'retrieval', 'testing', 'capstone'].map((capability) => [
      capability,
      cases.filter((c) => c.capability === capability).length,
    ])
  );
  assert.deepEqual(byCap, {
    feature: 27,
    bugfix: 24,
    docs: 10,
    retrieval: 10,
    testing: 11,
    capstone: 4,
  });
  assert.equal(cases.every((c) => c.variant === 1), true);
});

test('combined domains validate with unique ids', () => {
  const cases = loadCases(rootDir, { suite: 'all' });
  const validation = validateSuite(cases, rootDir, { suite: 'all' });
  assert.equal(validation.valid, true, validation.errors.join('\n'));
  assert.equal(validation.uniqueIds, cases.length);
  assert.equal(Object.keys(validation.bySuite).sort().join(','), DOMAINS.slice().sort().join(','));
});
