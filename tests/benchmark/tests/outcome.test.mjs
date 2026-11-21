import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { buildReport } from '../src/report.mjs';
import { renderExportMarkdown } from '../src/report-export-md.mjs';
import { runCases } from '../src/runner.mjs';
import { classifyOutcome, extractStageTimings, isContentPass } from '../src/outcome.mjs';

const ev = (type, stage, at) => JSON.stringify({ type, stage, at, runId: 'r' });

test('isContentPass ignores process-liveness checks', () => {
  assert.equal(
    isContentPass([
      { type: 'agent_exit', passed: false },
      { type: 'jsonl_event', passed: false },
      { type: 'file_contains', passed: true },
    ]),
    true,
  );
  assert.equal(
    isContentPass([
      { type: 'agent_exit', passed: true },
      { type: 'file_contains', passed: false },
    ]),
    false,
  );
  assert.equal(isContentPass([{ type: 'agent_exit', passed: true }]), false);
});

test('classifyOutcome separates content-pass timeouts from plain timeouts and failures', () => {
  const contentPass = [{ type: 'file_contains', passed: true }, { type: 'agent_exit', passed: false }];
  const contentFail = [{ type: 'file_contains', passed: false }];
  assert.equal(classifyOutcome({ passed: true, checks: contentPass }), 'passed');
  assert.equal(classifyOutcome({ passed: false, timedOut: true, checks: contentPass }), 'timeout_content_pass');
  assert.equal(classifyOutcome({ passed: false, timedOut: true, checks: contentFail }), 'timeout');
  assert.equal(classifyOutcome({ passed: false, aborted: true, checks: contentPass }), 'aborted');
  assert.equal(classifyOutcome({ passed: false, checks: contentFail }), 'failed');
});

test('extractStageTimings sums spans and closes open stages at the last event', () => {
  const stdout = [
    ev('stage_started', 'understood', '2026-01-01T00:00:00.000Z'),
    ev('stage_completed', 'understood', '2026-01-01T00:00:02.000Z'),
    ev('stage_started', 'discovery', '2026-01-01T00:00:02.000Z'),
    ev('stage_completed', 'discovery', '2026-01-01T00:00:05.000Z'),
    ev('stage_started', 'plan_ready', '2026-01-01T00:00:05.000Z'),
    ev('stage_completed', 'plan_ready', '2026-01-01T00:00:06.000Z'),
    ev('stage_started', 'model_running', '2026-01-01T00:00:06.000Z'),
    ev('stage_completed', 'model_running', '2026-01-01T00:00:08.000Z'),
    ev('stage_started', 'tool_running', '2026-01-01T00:00:08.000Z'),
    ev('stage_completed', 'tool_running', '2026-01-01T00:00:09.000Z'),
    ev('stage_started', 'model_running', '2026-01-01T00:00:09.000Z'),
    // run killed here: model_running stays open, closed at the last timestamp
    JSON.stringify({ type: 'model_delta', at: '2026-01-01T00:00:12.000Z' }),
    '{"type":"stage_started","stage":"adapter_ask"}',
  ].join('\n');
  assert.deepEqual(extractStageTimings(stdout), {
    understandingMs: 2000,
    discoveryMs: 3000,
    planningMs: 1000,
    loopMs: 2000 + 1000 + 3000,
    verifyMs: null,
  });
});

test('extractStageTimings returns nulls without timestamped events', () => {
  assert.deepEqual(extractStageTimings('plain text\n{"type":"end"}'), {
    understandingMs: null,
    discoveryMs: null,
    planningMs: null,
    loopMs: null,
    verifyMs: null,
  });
  assert.equal(extractStageTimings('').loopMs, null);
});

test('buildReport and brief expose the content-pass-but-timed-out bucket', () => {
  const base = { familyId: 'f', difficulty: 'easy', mode: 'agent', capability: 'feature', suite: 'frontend' };
  const results = [
    { ...base, id: 'a', passed: true, outcome: 'passed', durationMs: 1, checks: [] },
    { ...base, id: 'b', passed: false, outcome: 'timeout_content_pass', durationMs: 9, checks: [] },
    { ...base, id: 'c', passed: false, outcome: 'timeout', durationMs: 9, checks: [] },
    { ...base, id: 'd', passed: false, outcome: 'failed', durationMs: 2, checks: [] },
  ];
  const report = buildReport(results, { gates: {} }, new Date(), new Date(), { expectedTotal: 4 });
  assert.deepEqual(report.overall.outcomes, {
    passed: 1,
    timeout_content_pass: 1,
    timeout: 1,
    aborted: 0,
    failed: 1,
  });
  assert.equal(report.overall.timeoutContentPass, 1);
  assert.equal(report.overall.passed, 1, 'timed-out cases are never counted as passed');
  const md = renderExportMarkdown(report, { runId: 'x' });
  assert.match(md, /content-pass but timed out 1/);
  assert.match(md, /TIMEOUT\*\* \(content pass\)/);
});

test('runner records outcome, timedOut and stageTimings on the case result', async () => {
  const rootDir = mkdtempSync(join(tmpdir(), 'solid-bench-outcome-'));
  mkdirSync(join(rootDir, 'fixtures', 'sample'), { recursive: true });
  writeFileSync(join(rootDir, 'fixtures', 'sample', 'truth.txt'), 'answer=42\n');
  const fakeAgent = join(rootDir, 'slow-agent.mjs');
  writeFileSync(
    fakeAgent,
    [
      "const e = (type, stage, at) => console.log(JSON.stringify({ type, stage, at }));",
      "e('stage_started', 'understood', '2026-01-01T00:00:00.000Z');",
      "e('stage_completed', 'understood', '2026-01-01T00:00:01.500Z');",
      "console.log('The answer is 42');",
      'setTimeout(() => {}, 60000);',
    ].join('\n'),
  );
  const configPath = join(rootDir, 'benchmark.config.json');
  writeFileSync(configPath, '{}\n');
  const testCase = {
    id: 'easy-timeout-content-v1',
    familyId: 'timeout-content',
    variant: 1,
    difficulty: 'easy',
    mode: 'ask',
    capability: 'retrieval',
    fixture: 'sample',
    prompt: 'What is the answer?',
    preconditions: [],
    timeoutMs: 700,
    checks: [
      { type: 'agent_exit', equals: 0 },
      { type: 'output_contains', value: '42' },
    ],
  };
  const config = {
    agent: { command: 'node', args: [fakeAgent], cwd: rootDir, timeoutMs: 700, env: {} },
    run: { concurrency: 1, keepWorkspaces: false, ignoreChanges: ['.mitii'] },
    gates: {},
  };
  const [result] = await runCases([testCase], rootDir, config, { configPath });
  assert.equal(result.passed, false);
  assert.equal(result.timedOut, true);
  assert.equal(result.contentPass, true);
  assert.equal(result.outcome, 'timeout_content_pass');
  assert.equal(result.stageTimings.understandingMs, 1500);
  assert.equal(result.stageTimings.loopMs, null);
});
