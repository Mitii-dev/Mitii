import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  buildShareableDiagnostic,
  writeShareableDiagnostic,
} from '../src/shareableDiagnostic.ts';

describe('shareableDiagnostic', () => {
  it('builds a redacted one-file markdown summary from session + model-io logs', () => {
    const root = mkdtempSync(join(tmpdir(), 'mitii-shareable-'));
    const logs = join(root, '.mitii', 'logs');
    mkdirSync(logs, { recursive: true });

    writeFileSync(
      join(logs, '08-28-2026-10-00-AM-sess.jsonl'),
      [
        JSON.stringify({
          kind: 'run_start',
          at: '2026-08-28T00:00:00.000Z',
          prompt: 'Fix login with key sk-abcdefghijklmnop',
          mode: 'agent',
          runId: 'run_1',
        }),
        JSON.stringify({
          kind: 'event',
          type: 'warning',
          message: 'something failed',
          code: 'tool_failed',
          at: '2026-08-28T00:00:01.000Z',
        }),
        JSON.stringify({
          kind: 'event',
          type: 'tool_completed',
          toolName: 'read_file',
          status: 'ok',
          summary: 'read src/login.ts',
          at: '2026-08-28T00:00:02.000Z',
        }),
        JSON.stringify({
          kind: 'run_end',
          at: '2026-08-28T00:00:03.000Z',
          runId: 'run_1',
          status: 'failed',
          route: 'execute',
          answer: 'Could not finish',
          usage: { modelCalls: 1, toolCalls: 1, loopIterations: 1 },
          durationMs: 12,
        }),
      ].join('\n') + '\n',
      'utf8',
    );

    writeFileSync(
      join(logs, '08-28-2026-10-00-AM-sess-model-io.jsonl'),
      [
        JSON.stringify({
          kind: 'model_request',
          callId: 'call_1',
          portId: 'openai',
          request: {
            messageCount: 2,
            toolCount: 1,
            messages: [
              { role: 'system', content: 'system' },
              { role: 'user', content: 'please fix login' },
            ],
          },
        }),
        JSON.stringify({
          kind: 'model_response',
          callId: 'call_1',
          finishReason: 'stop',
          content: 'I will patch login',
          usage: { inputTokens: 100, outputTokens: 20 },
        }),
      ].join('\n') + '\n',
      'utf8',
    );

    const built = buildShareableDiagnostic({
      workspaceRoot: root,
      meta: {
        providerType: 'openai-compatible',
        model: 'qwen',
        developerEnabled: true,
        modelIoEnabled: true,
      },
    });

    expect(built.markdown).toContain('# Mitii shareable diagnostic');
    expect(built.markdown).toContain('[REDACTED]');
    expect(built.markdown).not.toContain('sk-abcdefghijklmnop');
    expect(built.markdown).toContain('read_file');
    expect(built.markdown).toContain('please fix login');
    expect(built.markdown).toContain('I will patch login');
    expect(built.sources.sessionLogPath).toContain('sess.jsonl');
    expect(built.sources.modelIoLogPath).toContain('model-io.jsonl');

    const written = writeShareableDiagnostic({
      workspaceRoot: root,
      fallbackDir: root,
      meta: { providerType: 'echo' },
    });
    const onDisk = readFileSync(written.path, 'utf8');
    expect(onDisk).toContain('shareable diagnostic');
    expect(written.path).toContain('shareable-diagnostic-');

    rmSync(root, { recursive: true, force: true });
  });
});
