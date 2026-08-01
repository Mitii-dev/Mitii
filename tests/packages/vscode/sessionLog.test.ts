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
});
