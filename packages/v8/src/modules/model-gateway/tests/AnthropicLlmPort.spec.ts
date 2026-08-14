import { describe, expect, it } from 'vitest';

import { AnthropicLlmPort, MODEL_PROVIDER_SUPPORT } from '..';
import type { ModelEvent } from '../contracts/types';

async function collectEvents(
  stream: AsyncIterable<ModelEvent>,
): Promise<ModelEvent[]> {
  const events: ModelEvent[] = [];
  for await (const event of stream) {
    events.push(event);
  }
  return events;
}

describe('AnthropicLlmPort', () => {
  it('is registered as a shipped adapter', () => {
    expect(MODEL_PROVIDER_SUPPORT.anthropic.status).toBe('supported');
    expect(MODEL_PROVIDER_SUPPORT.anthropic.adapter).toBe('AnthropicLlmPort');
  });

  it('maps non-streaming Messages responses including tools', async () => {
    let captured: { url?: string; headers?: HeadersInit; body?: string } = {};
    const fetchImpl: typeof fetch = async (input, init) => {
      captured = {
        url: String(input),
        headers: init?.headers,
        body: typeof init?.body === 'string' ? init.body : undefined,
      };
      return new Response(
        JSON.stringify({
          content: [
            { type: 'text', text: 'pong' },
            {
              type: 'tool_use',
              id: 'call-1',
              name: 'lookup',
              input: { q: '1' },
            },
          ],
          stop_reason: 'tool_use',
          usage: { input_tokens: 3, output_tokens: 2 },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    };

    const port = new AnthropicLlmPort({
      model: 'claude-sonnet-4-5',
      apiKey: 'sk-ant-test',
      fetchImpl,
    });

    const events = await collectEvents(
      port.complete({
        messages: [
          { role: 'system', content: 'Be brief.' },
          { role: 'user', content: 'ping' },
        ],
        stream: false,
        tools: [
          {
            name: 'lookup',
            description: 'Lookup a value',
            inputSchema: { type: 'object' },
          },
        ],
        toolChoice: 'auto',
      }),
    );

    expect(captured.url).toBe('https://api.anthropic.com/v1/messages');
    const headers = new Headers(captured.headers);
    expect(headers.get('x-api-key')).toBe('sk-ant-test');
    expect(headers.get('anthropic-version')).toBe('2023-06-01');
    const body = JSON.parse(captured.body ?? '{}') as {
      system?: string;
      tools?: Array<{ name: string }>;
      max_tokens?: number;
    };
    expect(body.system).toBe('Be brief.');
    expect(body.tools?.[0]?.name).toBe('lookup');
    expect(body.max_tokens).toBeGreaterThan(0);

    expect(events[0]).toEqual({ type: 'content_delta', content: 'pong' });
    expect(events[1]?.type).toBe('tool_call_delta');
    expect(
      events[1]?.type === 'tool_call_delta' && events[1].toolCalls[0]?.id,
    ).toBe('call-1');
    const completed = events.find((event) => event.type === 'completed');
    expect(completed?.type === 'completed' && completed.finishReason).toBe(
      'tool_calls',
    );
    expect(completed?.type === 'completed' && completed.usage?.totalTokens).toBe(
      5,
    );
  });

  it('maps SSE text and tool-use deltas', async () => {
    const payload = [
      'event: content_block_start',
      'data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}',
      '',
      'event: content_block_delta',
      'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"hel"}}',
      '',
      'event: content_block_delta',
      'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"lo"}}',
      '',
      'event: content_block_start',
      'data: {"type":"content_block_start","index":1,"content_block":{"type":"tool_use","id":"call-9","name":"lookup"}}',
      '',
      'event: content_block_delta',
      'data: {"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"{\\"q\\":"}}',
      '',
      'event: message_delta',
      'data: {"type":"message_delta","delta":{"stop_reason":"tool_use"},"usage":{"output_tokens":4}}',
      '',
      'event: message_stop',
      'data: {"type":"message_stop"}',
      '',
    ].join('\n');

    const port = new AnthropicLlmPort({
      model: 'claude-sonnet-4-5',
      fetchImpl: async () =>
        new Response(payload, {
          status: 200,
          headers: { 'Content-Type': 'text/event-stream' },
        }),
    });

    const events = await collectEvents(
      port.complete({
        messages: [{ role: 'user', content: 'hi' }],
        stream: true,
      }),
    );

    const text = events
      .filter((event) => event.type === 'content_delta')
      .map((event) => (event.type === 'content_delta' ? event.content : ''))
      .join('');
    expect(text).toBe('hello');
    expect(
      events.some(
        (event) =>
          event.type === 'tool_call_delta' && event.toolCalls[0]?.id === 'call-9',
      ),
    ).toBe(true);
    const completed = events.find((event) => event.type === 'completed');
    expect(completed?.type === 'completed' && completed.finishReason).toBe(
      'tool_calls',
    );
  });

  it('maps authentication failures', async () => {
    const port = new AnthropicLlmPort({
      model: 'claude-sonnet-4-5',
      apiKey: 'bad',
      fetchImpl: async () => new Response('unauthorized', { status: 401 }),
    });

    const events = await collectEvents(
      port.complete({
        messages: [{ role: 'user', content: 'hi' }],
        stream: false,
      }),
    );

    expect(events[0]?.type).toBe('failed');
    expect(events[0]?.type === 'failed' && events[0].error.code).toBe(
      'authentication_failed',
    );
    expect(events[0]?.type === 'failed' && events[0].error.retryable).toBe(
      false,
    );
  });

  it('cancels when the abort signal is already aborted', async () => {
    const port = new AnthropicLlmPort({ model: 'claude-sonnet-4-5' });
    const controller = new AbortController();
    controller.abort();
    const events = await collectEvents(
      port.complete(
        { messages: [{ role: 'user', content: 'hi' }] },
        { abortSignal: controller.signal },
      ),
    );
    expect(events[0]?.type).toBe('cancelled');
  });
});
