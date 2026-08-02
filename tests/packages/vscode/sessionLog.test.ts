import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';
import type { AgentRunResult, RunEvent } from '@mitii/sdk';

import { appendSessionLog } from '../../../apps/vscode/src/sessionLog.ts';

describe('sessionLog', () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const dir of dirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('persists compact verification evidence events', () => {
    const root = mkdtempSync(join(tmpdir(), 'mitii-session-log-'));
    dirs.push(root);

    const result = {
      schemaVersion: 1,
      runId: 'run_verify',
      requestId: 'req_verify',
      status: 'failed',
      route: 'execute',
      planningDepth: 'none',
      answer: 'verification failed',
      reasonCodes: ['verification_failed'],
      warnings: [],
      usage: { modelCalls: 1, toolCalls: 1, loopIterations: 1 },
      durationMs: 10,
      error: { code: 'verification_failed', message: 'Verification failed.' },
    } as AgentRunResult;

    const event = {
      type: 'verification_completed',
      runId: 'run_verify',
      status: 'verification_failed',
      reasonCodes: ['checks_failed'],
      checks: [
        {
          checkId: 'root:typecheck',
          kind: 'typecheck',
          outcome: 'failed',
          summary: 'Typecheck failed.',
        },
      ],
      diagnostics: [
        {
          path: 'src/a.ts',
          severity: 'error',
          message: 'Expected string.',
          startLine: 4,
        },
      ],
      warnings: ['Use pnpm install if dependencies are missing.'],
      at: '2026-07-28T00:00:00.000Z',
    } as RunEvent;

    const file = appendSessionLog(root, {
      kind: 'run',
      at: '2026-07-28T00:00:00.000Z',
      prompt: 'fix',
      mode: 'agent',
      result,
      events: [event],
    });

    expect(file).toBeTruthy();
    const lines = readFileSync(file!, 'utf8').trim().split('\n');
    const verificationLine = lines
      .map((line) => JSON.parse(line) as Record<string, unknown>)
      .find((line) => line.type === 'verification_completed');
    expect(verificationLine).toMatchObject({
      status: 'verification_failed',
      reasonCodes: ['checks_failed'],
      checks: [{ checkId: 'root:typecheck', outcome: 'failed' }],
      diagnostics: [{ path: 'src/a.ts', severity: 'error' }],
      warnings: ['Use pnpm install if dependencies are missing.'],
    });
  });

  it('keeps session logs readable by suppressing content deltas and truncating answers by context budget', () => {
    const root = mkdtempSync(join(tmpdir(), 'mitii-session-log-'));
    dirs.push(root);

    const result = {
      schemaVersion: 1,
      runId: 'run_big',
      requestId: 'req_big',
      status: 'completed',
      route: 'execute',
      planningDepth: 'none',
      answer: `Completed workspace edits.\n${'changed-file.ts\n'.repeat(22_000)}`,
      reasonCodes: ['answer_produced'],
      warnings: [],
      usage: { modelCalls: 1, toolCalls: 1, loopIterations: 1 },
      durationMs: 10,
    } as AgentRunResult;

    const events = [
      {
        type: 'model_delta',
        runId: 'run_big',
        kind: 'content',
        preview: 'word',
        at: '2026-07-28T00:00:00.000Z',
      },
      {
        type: 'model_delta',
        runId: 'run_big',
        kind: 'tool_call',
        preview: 'apply_patch',
        at: '2026-07-28T00:00:00.000Z',
      },
    ] as RunEvent[];

    const file = appendSessionLog(root, {
      kind: 'run',
      at: '2026-07-28T00:00:00.000Z',
      prompt: 'fix',
      mode: 'agent',
      result,
      events,
    }, {
      contextWindowTokens: 8_192,
      maximumOutputTokens: 4_096,
    });

    const lines = readFileSync(file!, 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(lines.some((line) => line.type === 'model_delta' && line.deltaKind === 'content')).toBe(false);
    expect(lines.some((line) => line.type === 'model_delta' && line.deltaKind === 'tool_call')).toBe(true);
    const runEnd = lines.find((line) => line.kind === 'run_end');
    expect(runEnd).toMatchObject({
      answerChars: result.answer!.length,
      answerTruncated: true,
    });
    expect(String(runEnd?.answer).length).toBeLessThan(result.answer!.length);
  });

  it('falls back to fixed answer truncation when context window is omitted', () => {
    const root = mkdtempSync(join(tmpdir(), 'mitii-session-log-'));
    dirs.push(root);

    const result = {
      schemaVersion: 1,
      runId: 'run_fallback_limits',
      requestId: 'req_fallback_limits',
      status: 'completed',
      route: 'execute',
      planningDepth: 'none',
      answer: `Completed workspace edits.\n${'changed-file.ts\n'.repeat(500)}`,
      reasonCodes: ['answer_produced'],
      warnings: [],
      usage: { modelCalls: 1, toolCalls: 0, loopIterations: 1 },
      durationMs: 10,
    } as AgentRunResult;

    const file = appendSessionLog(root, {
      kind: 'run',
      at: '2026-07-28T00:00:00.000Z',
      prompt: 'fix',
      mode: 'agent',
      result,
      events: [],
    });

    const lines = readFileSync(file!, 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    const runEnd = lines.find((line) => line.kind === 'run_end');
    expect(runEnd).toMatchObject({
      answerChars: result.answer!.length,
      answerTruncated: true,
    });
    expect(String(runEnd?.answer).length).toBeLessThanOrEqual(4_001);
  });

  it('scales answer retention for large-context models', () => {
    const root = mkdtempSync(join(tmpdir(), 'mitii-session-log-'));
    dirs.push(root);

    const result = {
      schemaVersion: 1,
      runId: 'run_large_context',
      requestId: 'req_large_context',
      status: 'completed',
      route: 'execute',
      planningDepth: 'none',
      answer: `Long answer\n${'section body\n'.repeat(20_000)}`,
      reasonCodes: ['answer_produced'],
      warnings: [],
      usage: { modelCalls: 1, toolCalls: 1, loopIterations: 1 },
      durationMs: 10,
    } as AgentRunResult;

    const file = appendSessionLog(root, {
      kind: 'run',
      at: '2026-07-28T00:00:00.000Z',
      prompt: 'explain',
      mode: 'ask',
      result,
      events: [],
    }, {
      contextWindowTokens: 252_000,
      maximumOutputTokens: 64_000,
    });

    const lines = readFileSync(file!, 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    const runEnd = lines.find((line) => line.kind === 'run_end');
    expect(runEnd).toMatchObject({
      answerChars: result.answer!.length,
      answerTruncated: false,
      answer: result.answer,
    });
  });
});
