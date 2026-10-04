import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';
import type { AgentRunResult, RunEvent } from '@mitii/sdk';

import {
  createMitiiThreadSessionId,
  openSessionLog,
  resolveMitiiSessionLogsDir,
} from './index.js';

describe('session-log', () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const dir of dirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('resolveMitiiSessionLogsDir prefers explicit then env then workspace', () => {
    const root = mkdtempSync(join(tmpdir(), 'mitii-logs-resolve-'));
    dirs.push(root);
    const explicit = join(root, 'explicit');
    expect(resolveMitiiSessionLogsDir(root, explicit)).toBe(explicit);
    expect(
      resolveMitiiSessionLogsDir(root, undefined, {
        MITII_LOGS_PATH: join(root, 'from-env'),
      }),
    ).toBe(join(root, 'from-env'));
    expect(resolveMitiiSessionLogsDir(root, undefined, {})).toBe(
      join(root, '.mitii', 'logs'),
    );
  });

  it('createMitiiThreadSessionId matches thread_* shape', () => {
    expect(createMitiiThreadSessionId()).toMatch(/^thread_[a-f0-9]+_[a-f0-9]+$/);
  });

  it('writes run_start, compacted events, and run_end like Desktop/VS Code', () => {
    const root = mkdtempSync(join(tmpdir(), 'mitii-session-log-'));
    dirs.push(root);

    const writer = openSessionLog(root, {
      at: '2026-07-28T00:00:00.000Z',
      prompt: 'fix while running',
      mode: 'agent',
      runId: 'run_live',
      sessionId: 'thread_live',
    });
    expect(writer).toBeTruthy();
    expect(writer!.path).toMatch(/thread_live\.jsonl$/);

    writer!.appendEvent({
      type: 'stage_started',
      runId: 'run_live',
      stage: 'understood',
      at: '2026-07-28T00:00:01.000Z',
    } as RunEvent);
    writer!.appendEvent({
      type: 'model_delta',
      runId: 'run_live',
      kind: 'content',
      preview: 'skip me',
      at: '2026-07-28T00:00:02.000Z',
    } as RunEvent);
    writer!.appendEvent({
      type: 'tool_started',
      runId: 'run_live',
      toolName: 'read_file',
      summary: 'src/a.ts',
      at: '2026-07-28T00:00:03.000Z',
    } as RunEvent);

    writer!.finish({
      schemaVersion: 1,
      runId: 'run_live',
      requestId: 'req_live',
      status: 'completed',
      route: 'execute',
      planningDepth: 'none',
      answer: 'done',
      reasonCodes: ['answer_produced'],
      warnings: [],
      usage: { modelCalls: 1, toolCalls: 1, loopIterations: 1 },
      durationMs: 10,
    } as AgentRunResult);

    const lines = readFileSync(writer!.path, 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(lines[0]).toMatchObject({
      kind: 'run_start',
      sessionId: 'thread_live',
      prompt: 'fix while running',
    });
    expect(lines.some((line) => line.type === 'model_delta')).toBe(false);
    expect(lines).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'stage_started', stage: 'understood' }),
        expect.objectContaining({ type: 'tool_started', toolName: 'read_file' }),
        expect.objectContaining({ kind: 'run_end', status: 'completed' }),
      ]),
    );
  });
});
