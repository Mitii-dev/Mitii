import { describe, expect, it } from 'vitest';
import type { AgentRunResult, RunEvent } from '@mitii/sdk';

import { formatVisibleFailureDetails } from '../../../apps/vscode/src/runReport.ts';

describe('runReport', () => {
  it('formats verification failure details with log path', () => {
    const result = {
      status: 'failed',
      error: {
        code: 'verification_failed',
        message: 'Verification did not succeed.',
      },
      reasonCodes: ['verification_failed', 'mutation_rolled_back'],
    } as AgentRunResult;

    const event = {
      type: 'verification_completed',
      status: 'verification_failed',
      reasonCodes: ['checks_failed'],
      checks: [
        {
          checkId: 'diagnostics:workspace',
          kind: 'diagnostics',
          outcome: 'failed',
          summary: 'Tool Runtime rejected Read workspace diagnostics.',
        },
      ],
      diagnostics: [
        {
          path: 'src/app.ts',
          severity: 'error',
          message: 'Expected string.',
          startLine: 12,
        },
      ],
      warnings: ['Use pnpm install if dependencies are missing.'],
    } as RunEvent;

    const details = formatVisibleFailureDetails({
      result,
      events: [event],
      sessionLogPath: '/workspace/.mitii/logs/thread.jsonl',
    });

    expect(details).toContain('Failure Details');
    expect(details).toContain('Verification did not succeed.');
    expect(details).toContain('checks_failed');
    expect(details).toContain(
      'Tool Runtime rejected Read workspace diagnostics.',
    );
    expect(details).toContain('src/app.ts:12 error: Expected string.');
    expect(details).toContain('/workspace/.mitii/logs/thread.jsonl');
  });
});
