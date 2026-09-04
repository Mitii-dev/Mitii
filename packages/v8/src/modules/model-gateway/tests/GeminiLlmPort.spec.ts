import { describe, expect, it } from 'vitest';

import { GeminiLlmPort, MODEL_PROVIDER_SUPPORT } from '..';
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

describe('GeminiLlmPort', () => {
  it('is registered as a shipped adapter', () => {
    expect(MODEL_PROVIDER_SUPPORT.gemini.status).toBe('supported');
    expect(MODEL_PROVIDER_SUPPORT.gemini.adapter).toBe('GeminiLlmPort');
  });

  it('maps non-streaming generateContent responses including tools', async () => {
    let captured: { url?: string; headers?: HeadersInit; body?: string } = {};
    const fetchImpl: typeof fetch = async (input, init) => {
      captured = {
        url: String(input),
        headers: init?.headers,
        body: typeof init?.body === 'string' ? init.body : undefined,
      };
      return new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                role: 'model',
                parts: [
                  { text: 'pong' },
                  { functionCall: { name: 'lookup', args: { q: '1' } } },
                ],
              },
              finishReason: 'STOP',
            },
          ],
          usageMetadata: {
            promptTokenCount: 3,
            candidatesTokenCount: 2,
            totalTokenCount: 5,
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    };

    const port = new GeminiLlmPort({
      model: 'gemini-2.5-flash',
      apiKey: 'gemini-test',
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
      }),
    );

    expect(captured.url).toContain(
      '/v1beta/models/gemini-2.5-flash:generateContent',
    );
    const headers = new Headers(captured.headers);
    expect(headers.get('x-goog-api-key')).toBe('gemini-test');
    const body = JSON.parse(captured.body ?? '{}') as {
      systemInstruction?: { parts?: Array<{ text?: string }> };
      tools?: Array<{ functionDeclarations?: Array<{ name: string }> }>;
    };
    expect(body.systemInstruction?.parts?.[0]?.text).toBe('Be brief.');
    expect(body.tools?.[0]?.functionDeclarations?.[0]?.name).toBe('lookup');

    expect(events[0]).toEqual({ type: 'content_delta', content: 'pong' });
    expect(events[1]?.type).toBe('tool_call_delta');
    expect(
      events[1]?.type === 'tool_call_delta' && events[1].toolCalls[0]?.name,
    ).toBe('lookup');
    expect(
      events[1]?.type === 'tool_call_delta' && events[1].toolCalls[0]?.id,
    ).toBe('call_0');
    const completed = events.find((event) => event.type === 'completed');
    expect(completed?.type === 'completed' && completed.finishReason).toBe(
      'tool_calls',
    );
    expect(completed?.type === 'completed' && completed.usage?.totalTokens).toBe(
      5,
    );
  });

  it('allocates unique tool call ids across successive complete() turns', async () => {
    const fetchImpl: typeof fetch = async () =>
      new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                role: 'model',
                parts: [
                  { functionCall: { name: 'search_files', args: { q: 'a' } } },
                ],
              },
              finishReason: 'STOP',
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );

    const port = new GeminiLlmPort({
      model: 'gemini-3.5-flash',
      apiKey: 'gemini-test',
      fetchImpl,
    });

    const tools = [
      {
        name: 'search_files',
        description: 'Search',
        inputSchema: { type: 'object' },
      },
    ];

    const first = await collectEvents(
      port.complete({
        messages: [{ role: 'user', content: 'search a' }],
        stream: false,
        tools,
      }),
    );
    const second = await collectEvents(
      port.complete({
        messages: [{ role: 'user', content: 'search b' }],
        stream: false,
        tools,
      }),
    );

    const firstId =
      first[0]?.type === 'tool_call_delta' ? first[0].toolCalls[0]?.id : undefined;
    const secondId =
      second[0]?.type === 'tool_call_delta'
        ? second[0].toolCalls[0]?.id
        : undefined;

    expect(firstId).toBe('call_0');
    expect(secondId).toBe('call_1');
    expect(secondId).not.toBe(firstId);
  });

  it('maps SSE streamGenerateContent chunks', async () => {
    const payload = [
      'data: {"candidates":[{"content":{"parts":[{"text":"hel"}]}}]}',
      '',
      'data: {"candidates":[{"content":{"parts":[{"text":"lo"}]},"finishReason":"STOP"}]}',
      '',
    ].join('\n');

    const port = new GeminiLlmPort({
      model: 'gemini-2.5-flash',
      fetchImpl: async (input) => {
        expect(String(input)).toContain('streamGenerateContent');
        expect(String(input)).toContain('alt=sse');
        return new Response(payload, {
          status: 200,
          headers: { 'Content-Type': 'text/event-stream' },
        });
      },
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
    const completed = events.find((event) => event.type === 'completed');
    expect(completed?.type === 'completed' && completed.finishReason).toBe(
      'stop',
    );
  });

  it('maps authentication failures', async () => {
    const port = new GeminiLlmPort({
      model: 'gemini-2.5-flash',
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
  });

  it('maps safety blocks to content_filtered', async () => {
    const port = new GeminiLlmPort({
      model: 'gemini-2.5-flash',
      fetchImpl: async () =>
        new Response(
          JSON.stringify({
            promptFeedback: { blockReason: 'SAFETY' },
            candidates: [],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
    });

    const events = await collectEvents(
      port.complete({
        messages: [{ role: 'user', content: 'hi' }],
        stream: false,
      }),
    );

    expect(events[0]?.type).toBe('failed');
    expect(events[0]?.type === 'failed' && events[0].error.code).toBe(
      'content_filtered',
    );
  });

  it('captures thoughtSignature from functionCall parts', async () => {
    const port = new GeminiLlmPort({
      model: 'gemini-3.5-flash',
      apiKey: 'gemini-test',
      fetchImpl: async () =>
        new Response(
          JSON.stringify({
            candidates: [
              {
                content: {
                  role: 'model',
                  parts: [
                    {
                      functionCall: { name: 'read_file', args: { path: 'a.ts' } },
                      thoughtSignature: 'sig-abc',
                    },
                  ],
                },
                finishReason: 'STOP',
              },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
    });

    const events = await collectEvents(
      port.complete({
        messages: [{ role: 'user', content: 'read a.ts' }],
        stream: false,
        tools: [
          {
            name: 'read_file',
            description: 'Read a file',
            inputSchema: { type: 'object' },
          },
        ],
      }),
    );

    expect(events[0]?.type).toBe('tool_call_delta');
    expect(
      events[0]?.type === 'tool_call_delta' &&
        events[0].toolCalls[0]?.thoughtSignature,
    ).toBe('sig-abc');
  });

  it('echoes thoughtSignature on follow-up functionCall parts', async () => {
    let capturedBody: string | undefined;
    const port = new GeminiLlmPort({
      model: 'gemini-3.5-flash',
      apiKey: 'gemini-test',
      fetchImpl: async (_input, init) => {
        capturedBody =
          typeof init?.body === 'string' ? init.body : undefined;
        return new Response(
          JSON.stringify({
            candidates: [
              {
                content: { role: 'model', parts: [{ text: 'done' }] },
                finishReason: 'STOP',
              },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      },
    });

    await collectEvents(
      port.complete({
        messages: [
          { role: 'user', content: 'read a.ts' },
          {
            role: 'assistant',
            content: '',
            toolCalls: [
              {
                id: 'call_0',
                name: 'read_file',
                arguments: '{"path":"a.ts"}',
                thoughtSignature: 'sig-abc',
              },
            ],
          },
          {
            role: 'tool',
            toolCallId: 'call_0',
            name: 'read_file',
            content: '{"status":"succeeded"}',
          },
        ],
        stream: false,
        tools: [
          {
            name: 'read_file',
            description: 'Read a file',
            inputSchema: { type: 'object' },
          },
        ],
      }),
    );

    const body = JSON.parse(capturedBody ?? '{}') as {
      contents?: Array<{
        role?: string;
        parts?: Array<{
          functionCall?: { name?: string };
          thoughtSignature?: string;
        }>;
      }>;
    };
    const modelTurn = body.contents?.find((item) =>
      item.parts?.some((part) => part.functionCall?.name === 'read_file'),
    );
    expect(modelTurn?.parts?.[0]?.thoughtSignature).toBe('sig-abc');
  });
});
