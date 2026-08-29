import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createRunReporter, writeCaseReport } from '../src/report.mjs';
import { generateViewer, sanitizeReportForViewer } from '../src/html-report.mjs';

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
  assert.equal(existsSync(summaryPaths.html), true);
  const summary = JSON.parse(readFileSync(summaryPaths.json, 'utf8'));
  assert.equal(summary.signal, 'RUNNING');
  assert.equal(summary.completed, 1);
  const html = readFileSync(summaryPaths.html, 'utf8');
  assert.match(html, /Benchmark run/);
  assert.match(html, /fe-002-demo-v1/);
});

test('sanitizeReportForViewer drops bulky stdout', () => {
  const sanitized = sanitizeReportForViewer({
    suite: 'frontend',
    signal: 'GO',
    overall: { total: 1, passed: 1, failed: 0, caseScore: 1, familyScore: 1 },
    results: [
      {
        id: 'x',
        passed: true,
        stdout: 'a'.repeat(5000),
        stderr: 'b'.repeat(100),
        checks: [{ type: 'command', passed: true, details: 'c'.repeat(1000) }],
      },
    ],
  });
  assert.equal(sanitized.results[0].stdout, undefined);
  assert.ok(sanitized.results[0].stdoutPreview.length < 1000);
  assert.ok(sanitized.results[0].checks[0].details.endsWith('…'));
});

test('generateViewer writes index and per-run html', () => {
  const root = mkdtempSync(join(tmpdir(), 'solid-bench-viewer-'));
  const runId = '2026-01-01T00-00-00-000Z-abcd1234';
  const runDir = join(root, 'runs', runId);
  mkdirSync(runDir, { recursive: true });
  writeFileSync(
    join(runDir, 'summary.json'),
    JSON.stringify({
      startedAt: '2026-01-01T00:00:00.000Z',
      finishedAt: '2026-01-01T00:01:00.000Z',
      suite: 'frontend',
      signal: 'GO',
      completed: 1,
      expectedTotal: 1,
      overall: { total: 1, passed: 1, failed: 0, caseScore: 1, familyScore: 1, avgDurationMs: 10 },
      difficulties: {},
      byCategory: {},
      byCapability: {},
      results: [{ id: 'case-1', passed: true, difficulty: 'easy', category: 'ui', capability: 'feature' }],
    })
  );
  const { indexPath, written } = generateViewer(root);
  assert.equal(existsSync(indexPath), true);
  assert.equal(written.length, 1);
  assert.match(readFileSync(indexPath, 'utf8'), /Benchmark runs/);
  assert.match(readFileSync(written[0], 'utf8'), /case-1/);
});
