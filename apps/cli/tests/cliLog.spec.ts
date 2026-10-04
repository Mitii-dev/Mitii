import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';
import {
  createMitiiClient,
  EchoLlmPort,
  type LlmPort,
} from '@mitii/sdk';
import type { ModelCapabilities, ModelEvent, ModelRequest } from '@mitii/v8';

import {
  isCliSessionLogEnabled,
  isCliSessionLogFileName,
  resolveCliSessionLogMode,
} from '../src/cliLog.js';
import { driveRun, type SessionIo } from '../src/session.js';

class LocalUnderstandingLlmPort implements LlmPort {
  readonly id = 'test-understanding';
  readonly capabilities: ModelCapabilities = {
    modelId: 'test/understanding',
    supportsStreaming: true,
    supportsTools: false,
    supportsParallelToolCalls: false,
    supportsVision: false,
    supportsStructuredOutput: true,
    supportsReasoning: false,
    supportsPromptCaching: false,
    supportsEmbeddings: false,
    contextWindowTokens: 8_192,
    maximumOutputTokens: 1_000,
  };

  async *complete(_request: ModelRequest): AsyncIterable<ModelEvent> {
    yield {
      type: 'content_delta',
      content: JSON.stringify({
        interactionIntent: 'question',
        primaryTaskIntent: 'question',
        secondaryTaskIntents: [],
        confidence: 0.95,
        alternatives: [],
        needsClarification: false,
        reason: 'test',
      }),
    };
    yield { type: 'completed', finishReason: 'stop' };
  }
}

function memoryIo(): SessionIo & { stdout: string[]; stderr: string[] } {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return {
    stdout,
    stderr,
    writeStdout: (c) => {
      stdout.push(c);
    },
    writeStderr: (c) => {
      stderr.push(c);
    },
    prompt: async () => '',
  };
}

describe('CLI session log enablement', () => {
  it('defaults to full; MITII_CLI_LOG=0 disables', () => {
    expect(resolveCliSessionLogMode({})).toBe('full');
    expect(isCliSessionLogEnabled({ MITII_CLI_LOG: 'full' })).toBe(true);
    expect(isCliSessionLogEnabled({ MITII_CLI_LOG: '0' })).toBe(false);
    expect(isCliSessionLogEnabled({ MITII_CLI_LOG: 'false' })).toBe(false);
  });

  it('recognizes Desktop/VS Code stamp filenames', () => {
    expect(
      isCliSessionLogFileName('10-02-2026-19-43-thread_muro3rv6_knqw8.jsonl'),
    ).toBe(true);
    expect(isCliSessionLogFileName('cli-2026-10-02T16-00-00-000Z.jsonl')).toBe(
      true,
    );
    expect(
      isCliSessionLogFileName(
        '10-02-2026-19-43-thread_x-model-io.jsonl',
      ),
    ).toBe(false);
  });
});

describe('CLI driveRun full session log', () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const dir of dirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('writes run_start / events / run_end under logsDir', async () => {
    const root = mkdtempSync(join(tmpdir(), 'mitii-cli-session-log-'));
    dirs.push(root);
    const logsDir = join(root, 'logs');

    const client = createMitiiClient({
      understandingLlm: new LocalUnderstandingLlmPort(),
      runLlm: new EchoLlmPort(),
      defaultMode: 'ask',
      defaultSessionId: 'thread_cli_test',
    });
    const io = memoryIo();
    const outcome = await driveRun({
      client,
      start: {
        prompt: 'What is recursion?',
        mode: 'ask',
        sessionId: 'thread_cli_test',
      },
      json: true,
      io,
      sessionLog: {
        workspaceRoot: root,
        logsDir,
        sessionId: 'thread_cli_test',
      },
    });

    expect(outcome.exitCode).toBe(0);
    expect(outcome.sessionLogPath).toBeTruthy();
    expect(outcome.sessionLogPath).toContain('thread_cli_test.jsonl');

    const lines = readFileSync(outcome.sessionLogPath!, 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(lines[0]).toMatchObject({
      kind: 'run_start',
      sessionId: 'thread_cli_test',
      prompt: 'What is recursion?',
    });
    expect(lines.at(-1)).toMatchObject({
      kind: 'run_end',
      status: 'completed',
    });
    expect(
      lines.some(
        (line) =>
          line.kind === 'event' &&
          typeof line.type === 'string' &&
          (line.type as string).length > 0,
      ),
    ).toBe(true);
    // content deltas should be compacted away
    expect(
      lines.some(
        (line) => line.type === 'model_delta' && line.deltaKind === 'content',
      ),
    ).toBe(false);
  });
});
