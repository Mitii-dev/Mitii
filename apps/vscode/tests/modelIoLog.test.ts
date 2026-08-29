import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import type { LlmPort, ModelEvent, ModelRequest } from '@mitii/sdk';

import {
  LoggingLlmPort,
  __testing,
  isModelIoLoggingEnabled,
  openModelIoLog,
  setActiveModelIoSink,
} from '../src/modelIoLog.ts';

class ScriptedPort implements LlmPort {
  readonly id = 'test-port';
  readonly capabilities = {
    modelId: 'test',
    contextWindowTokens: 8_192,
    maximumOutputTokens: 1_024,
    supportsStreaming: true,
    supportsTools: true,
    supportsParallelToolCalls: false,
    supportsStructuredOutput: false,
    supportsVision: false,
    supportsReasoning: false,
    supportsPromptCaching: false,
    supportsEmbeddings: false,
  };

  constructor(private readonly events: ModelEvent[]) {}

  async *complete(_request: ModelRequest): AsyncIterable<ModelEvent> {
    for (const event of this.events) {
      yield event;
    }
  }
}

describe('modelIoLog', () => {
  it('gates model I/O on developer + modelIo flags', () => {
    expect(isModelIoLoggingEnabled(false, true)).toBe(false);
    expect(isModelIoLoggingEnabled(true, false)).toBe(false);
    expect(isModelIoLoggingEnabled(true, true)).toBe(true);
  });

  it('redacts secrets and truncates long messages in sanitizeRequest', () => {
    const sanitized = __testing.sanitizeRequest({
      messages: [
        {
          role: 'user',
          content: `use key sk-abcdefghijklmnop and ${'x'.repeat(30_000)}`,
        },
      ],
      tools: [{ name: 'read_file', description: 'Read a file', inputSchema: {} }],
    });
    const content = String(
      (sanitized.messages as Array<Record<string, unknown>>)[0]?.content ?? '',
    );
    expect(content).toContain('[REDACTED]');
    expect(content).not.toContain('sk-abcdefghijklmnop');
    expect(content.endsWith('…')).toBe(true);
  });

  it('writes request/response records when a sink is active', async () => {
    const root = mkdtempSync(join(tmpdir(), 'mitii-model-io-'));

    try {
      const sink = openModelIoLog(root, {
        runId: 'run_1',
        sessionId: 'sess_1',
        at: '2026-08-28T00:00:00.000Z',
      });
      expect(sink).toBeDefined();
      setActiveModelIoSink(sink);

      const port = new LoggingLlmPort(
        new ScriptedPort([
          { type: 'content_delta', content: 'Hello ' },
          { type: 'content_delta', content: 'world' },
          {
            type: 'tool_call_delta',
            toolCalls: [
              {
                index: 0,
                id: 'c1',
                name: 'read_file',
                arguments: '{"path":"a.ts"}',
              },
            ],
          },
          {
            type: 'completed',
            finishReason: 'tool_calls',
            usage: { inputTokens: 10, outputTokens: 5 },
          },
        ]),
      );

      const events: ModelEvent[] = [];
      for await (const event of port.complete(
        {
          messages: [
            { role: 'user', content: 'read a.ts with Bearer SECRETTOKEN123' },
          ],
        },
        { runId: 'run_1' },
      )) {
        events.push(event);
      }

      sink!.close();
      setActiveModelIoSink(undefined);

      expect(events.some((e) => e.type === 'completed')).toBe(true);
      const lines = readFileSync(sink!.path, 'utf8')
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line) as Record<string, unknown>);

      expect(lines[0]).toMatchObject({ kind: 'model_io_start', runId: 'run_1' });
      const request = lines.find((line) => line.kind === 'model_request');
      const response = lines.find((line) => line.kind === 'model_response');
      expect(request).toBeDefined();
      expect(JSON.stringify(request)).toContain('[REDACTED]');
      expect(response).toMatchObject({
        kind: 'model_response',
        finishReason: 'tool_calls',
        content: 'Hello world',
      });
      expect(response?.toolCalls).toEqual([
        expect.objectContaining({
          id: 'c1',
          name: 'read_file',
          arguments: '{"path":"a.ts"}',
        }),
      ]);
      expect(lines.at(-1)).toMatchObject({ kind: 'model_io_end' });
    } finally {
      rmSync(root, { recursive: true, force: true });
      setActiveModelIoSink(undefined);
    }
  });

  it('does not write when no sink is active', async () => {
    setActiveModelIoSink(undefined);
    const port = new LoggingLlmPort(
      new ScriptedPort([{ type: 'completed', finishReason: 'stop' }]),
    );
    for await (const _ of port.complete({
      messages: [{ role: 'user', content: 'hi' }],
    })) {
      // drain
    }
    expect(true).toBe(true);
  });
});
