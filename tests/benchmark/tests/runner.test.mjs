import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { runCases } from '../src/runner.mjs';

test('runner executes an agent in a fresh isolated fixture', async () => {
  const rootDir = mkdtempSync(join(tmpdir(), 'solid-bench-runner-'));
  mkdirSync(join(rootDir, 'fixtures', 'sample'), { recursive: true });
  writeFileSync(join(rootDir, 'fixtures', 'sample', 'truth.txt'), 'answer=42\n');
  const fakeAgent = join(rootDir, 'fake-agent.mjs');
  writeFileSync(fakeAgent, "console.log(JSON.stringify({type:'done',content:'The answer is 42'}));\n");
  const configPath = join(rootDir, 'benchmark.config.json');
  writeFileSync(configPath, '{}\n');
  const testCase = {
    id: 'easy-runner-self-test-v1',
    familyId: 'runner-self-test',
    variant: 1,
    difficulty: 'easy',
    mode: 'ask',
    capability: 'retrieval',
    fixture: 'sample',
    prompt: 'What is the answer?',
    preconditions: [{ type: 'file_contains', path: 'truth.txt', value: '42' }],
    checks: [
      { type: 'agent_exit', equals: 0 },
      { type: 'output_not_empty' },
      { type: 'output_contains', value: '42' },
      { type: 'jsonl_event', event: 'end' },
      { type: 'workspace_unchanged' }
    ],
  };
  const config = {
    agent: {
      command: 'node',
      args: [fakeAgent, '{mode}', '{prompt}', '{workspace}'],
      cwd: rootDir,
      timeoutMs: 5000,
      env: {},
    },
    run: {
      concurrency: 1,
      keepWorkspaces: false,
      ignoreChanges: ['node_modules', 'dist', '.mitii'],
    },
    gates: { easy: 0.95, medium: 0.85, hard: 0.7, overall: 0.85 },
  };
  const [result] = await runCases([testCase], rootDir, config, { configPath });
  assert.equal(result.passed, true, JSON.stringify(result, null, 2));
});
