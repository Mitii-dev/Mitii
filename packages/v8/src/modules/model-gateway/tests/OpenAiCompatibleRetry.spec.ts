import { describe, expect, it } from 'vitest';

import { OpenAiCompatibleLlmPort } from '..';
import type { ModelEvent } from '../contracts/types';

async function collectContent(
  stream: AsyncIterable<ModelEvent>,
): Promise<string> {
  let content = '';
  for await (const event of stream) {
    if (event.type === 'content_delta') {
      content += event.content;
    }
  }
  return content;
}

async function collectEvents(
  stream: AsyncIterable<ModelEvent>,
): Promise<ModelEvent[]> {
  const events: ModelEvent[] = [];
  for await (const event of stream) {
    events.push(event);
  }
  return events;
}

describe('OpenAiCompatibleLlmPort retries', () => {
  it('retries retryable HTTP errors with backoff', async () => {
    let calls = 0;
    const sleeps: number[] = [];
    const fetchImpl: typeof fetch = async () => {
      calls += 1;
      if (calls < 3) {
        return new Response('busy', {
          status: 503,
          headers: { 'Retry-After': '0' },
        });
      }
      return new Response(
        JSON.stringify({
          choices: [
            { message: { content: 'recovered' }, finish_reason: 'stop' },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    };

    const port = new OpenAiCompatibleLlmPort({
      model: 'test',
      fetchImpl,
      maxRetries: 2,
      sleepImpl: async (ms) => {
        sleeps.push(ms);
      },
    });

    const content = await collectContent(
      port.complete({
        messages: [{ role: 'user', content: 'hi' }],
        stream: false,
      }),
    );

    expect(content).toBe('recovered');
    expect(calls).toBe(3);
    expect(sleeps).toHaveLength(2);
  });

  it('does not retry authentication failures', async () => {
    let calls = 0;
    const fetchImpl: typeof fetch = async () => {
      calls += 1;
      return new Response('nope', { status: 401 });
    };

    const port = new OpenAiCompatibleLlmPort({
      model: 'test',
      fetchImpl,
      maxRetries: 3,
      sleepImpl: async () => {
        throw new Error('should not sleep');
      },
    });

    const events = await collectEvents(
      port.complete({
        messages: [{ role: 'user', content: 'hi' }],
        stream: false,
      }),
    );

    expect(calls).toBe(1);
    expect(events[0]?.type).toBe('failed');
    expect(events[0]?.type === 'failed' && events[0].error.retryable).toBe(
      false,
    );
  });

  it('maps prompt cache hit and miss tokens from usage', async () => {
    const fetchImpl: typeof fetch = async () =>
      new Response(
        JSON.stringify({
          choices: [
            {
              message: { content: 'ok' },
              finish_reason: 'stop',
            },
          ],
          usage: {
            prompt_tokens: 100,
            completion_tokens: 8,
            total_tokens: 108,
            prompt_cache_hit_tokens: 70,
            prompt_cache_miss_tokens: 30,
          },
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        },
      );

    const port = new OpenAiCompatibleLlmPort({
      baseUrl: 'https://api.deepseek.com/v1',
      model: 'deepseek-chat',
      apiKey: 'secret',
      fetchImpl,
      capabilities: { supportsPromptCaching: true },
    });

    const events = await collectEvents(
      port.complete({
        messages: [{ role: 'user', content: 'ping' }],
        stream: false,
      }),
    );
    const completed = events.find((event) => event.type === 'completed');
    expect(completed?.type === 'completed' && completed.usage?.cacheHitTokens).toBe(
      70,
    );
    expect(
      completed?.type === 'completed' && completed.usage?.cacheMissTokens,
    ).toBe(30);
  });
});
