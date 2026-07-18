import { mkdtemp, readFile, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { withLlmTracing } from '../src/core/llm/TracingLlmProvider';
import type { LlmProvider } from '../src/core/llm/types';
import { AsyncDebugTrace, debugTrace } from '../src/core/telemetry/AsyncDebugTrace';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  debugTrace.configure('', '', { enabled: false });
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe('async debug tracing', () => {
  it('batches trace writes and recursively redacts payload secrets', async () => {
    const workspace = await createTemporaryWorkspace();
    const trace = new AsyncDebugTrace();
    trace.configure(workspace, 'session-redaction', {
      enabled: true,
      includePayloads: true,
      llm: true,
    });

    trace.trace('llm', 'request_send', { nested: { authorization: 'Bearer top-secret-token' } }, {
      message: 'Bearer another-secret-token',
    });
    await trace.flush();

    const contents = await readFile(
      join(workspace, '.mitii', 'logs', 'session-redaction.trace.jsonl'),
      'utf8'
    );
    expect(contents).toContain('"request_send"');
    expect(contents).toContain('[REDACTED]');
    expect(contents).not.toContain('top-secret-token');
    expect(contents).not.toContain('another-secret-token');
  });

  it('records every semantic LLM delta and a completion summary', async () => {
    const workspace = await createTemporaryWorkspace();
    debugTrace.configure(workspace, 'session-llm', {
      enabled: true,
      includePayloads: false,
      llm: true,
      mcp: false,
      webview: false,
    });
    const provider: LlmProvider = {
      id: 'fake',
      capabilities: {
        contextWindow: 8_192,
        supportsStreaming: true,
        supportsTools: true,
        supportsEmbeddings: false,
      },
      async *complete() {
        yield { content: 'hello' };
        yield { done: true, finish_reason: 'stop' };
      },
    };

    const deltas = [];
    for await (const delta of withLlmTracing(provider).complete({
      messages: [{ role: 'user', content: 'test' }],
      stream: true,
    })) {
      deltas.push(delta);
    }
    await debugTrace.flush();

    const contents = await readFile(
      join(workspace, '.mitii', 'logs', 'session-llm.trace.jsonl'),
      'utf8'
    );
    const events = contents.trim().split('\n').map((line) => JSON.parse(line) as { event: string });
    expect(deltas).toHaveLength(2);
    expect(events.map((event) => event.event)).toEqual([
      'request_send',
      'response_start',
      'response_delta',
      'response_delta',
      'response_end',
    ]);
  });
});

async function createTemporaryWorkspace(): Promise<string> {
  const workspace = await mkdtemp(join(tmpdir(), 'mitii-debug-trace-'));
  temporaryDirectories.push(workspace);
  return workspace;
}
