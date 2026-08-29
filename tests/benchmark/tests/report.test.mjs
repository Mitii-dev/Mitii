import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createRunReporter, writeCaseReport } from '../src/report.mjs';

test('writeCaseReport creates json and markdown per case', () => {
  const dir = mkdtempSync(join(tmpdir(), 'solid-bench-case-report-'));
  const paths = writeCaseReport(
    {
      id: 'fe-001-demo-v1',
      suite: 'frontend',
      mode: 'agent',
      fixture: 'frontend-app',
      capability: 'feature',
      passed: true,
      durationMs: 12,
      checks: [{ type: 'command', passed: true, details: 'ok' }],
      preconditions: [],
    },
    dir,
    { index: 0, total: 1, runId: 'test-run' }
  );
  assert.equal(existsSync(paths.json), true);
  assert.equal(existsSync(paths.markdown), true);
  const md = readFileSync(paths.markdown, 'utf8');
  assert.match(md, /PASS/);
  assert.match(md, /fe-001-demo-v1/);
  assert.match(md, /Tokens \/ usage/);
});

test('createRunReporter writes live summary after each case', () => {
  const runDir = mkdtempSync(join(tmpdir(), 'solid-bench-run-'));
  const reporter = createRunReporter({
    runId: 'live-run',
    runDir,
    startedAt: new Date(),
    config: { gates: { overall: 0.5 } },
    suite: 'frontend',
  });
  const result = {
    id: 'fe-002-demo-v1',
    familyId: 'fe-demo',
    variant: 1,
    suite: 'frontend',
    category: 'project-setup',
    difficulty: 'easy',
    mode: 'agent',
    capability: 'feature',
    fixture: 'frontend-app',
    passed: true,
    durationMs: 5,
    checks: [{ type: 'agent_exit', passed: true }],
    preconditions: [],
  };
  const { casePaths, summaryPaths } = reporter.record(result, 0, 2);
  assert.equal(existsSync(casePaths.markdown), true);
  assert.equal(existsSync(summaryPaths.markdown), true);
  const summary = JSON.parse(readFileSync(summaryPaths.json, 'utf8'));
  assert.equal(summary.signal, 'RUNNING');
  assert.equal(summary.completed, 1);
});
