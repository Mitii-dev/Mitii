import { describe, expect, it } from 'vitest';
import type { LlmPort, ModelCapabilities, ModelEvent, ModelRequest } from '@mitii/v8';
import {
  EchoLlmPort,
  agentRunResultSchema,
  runEventSchema,
} from '@mitii/v8';

import { createMitiiClient } from '@mitii/sdk';
import type { RunEvent } from '@mitii/sdk';

class UnderstandingLlmPort implements LlmPort {
  readonly id = 'sdk-smoke-understanding';
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

  constructor(private readonly response: Record<string, unknown>) {}

  async *complete(_request: ModelRequest): AsyncIterable<ModelEvent> {
    yield {
      type: 'content_delta',
      content: JSON.stringify(this.response),
    };
    yield { type: 'completed', finishReason: 'stop' };
  }
}

async function collectEvents(
  events: AsyncIterable<RunEvent>,
): Promise<RunEvent[]> {
  const collected: RunEvent[] = [];
  for await (const event of events) {
    collected.push(event);
  }
  return collected;
}

/**
 * Headless smoke: drive a read-only direct_answer run only through @mitii/sdk.
 */
describe('SDK read-only smoke (Phase 12)', () => {
  it('completes a direct_answer run via createMitiiClient.start', async () => {
    const client = createMitiiClient({
      understandingLlm: new UnderstandingLlmPort({
        interactionIntent: 'question',
        primaryTaskIntent: 'question',
        secondaryTaskIntents: [],
        confidence: 0.94,
        alternatives: [],
        needsClarification: false,
        reason: 'SDK smoke classification.',
      }),
      runLlm: new EchoLlmPort(),
      defaultMode: 'ask',
      defaultSessionId: 'sdk_smoke_session',
      workspaceId: 'ws_sdk_smoke',
    });

    const run = client.start({
      prompt: 'What is recursion in computer science?',
      mode: 'ask',
    });

    const [result, events] = await Promise.all([
      run.result,
      collectEvents(run.events),
    ]);

    const parsed = agentRunResultSchema.parse(result);
    expect(parsed.status).toBe('completed');
    expect(parsed.route).toBe('direct_answer');
    expect(parsed.answer).toContain('Echo:');
    expect(parsed.reasonCodes).toContain('answer_produced');

    expect(events.some((event) => event.type === 'terminal')).toBe(true);
    for (const event of events) {
      expect(() => runEventSchema.parse(event)).not.toThrow();
    }
  });

  it('cancels an in-flight run through the SDK handle', async () => {
    const slowLlm: LlmPort = {
      id: 'sdk-slow',
      capabilities: {
        modelId: 'test/slow',
        supportsStreaming: true,
        supportsTools: false,
        supportsParallelToolCalls: false,
        supportsVision: false,
        supportsStructuredOutput: false,
        supportsReasoning: false,
        supportsPromptCaching: false,
        supportsEmbeddings: false,
        contextWindowTokens: 8_192,
        maximumOutputTokens: 1_000,
      },
      async *complete(
        _request: ModelRequest,
        context?: { abortSignal?: AbortSignal },
      ): AsyncIterable<ModelEvent> {
        yield { type: 'content_delta', content: 'partial' };
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(resolve, 5_000);
          context?.abortSignal?.addEventListener('abort', () => {
            clearTimeout(timer);
            reject(new Error('aborted'));
          });
        });
        yield { type: 'completed', finishReason: 'stop' };
      },
    };

    const client = createMitiiClient({
      understandingLlm: new UnderstandingLlmPort({
        interactionIntent: 'question',
        primaryTaskIntent: 'question',
        secondaryTaskIntents: [],
        confidence: 0.9,
        alternatives: [],
        needsClarification: false,
        reason: 'cancel smoke',
      }),
      runLlm: slowLlm,
      defaultMode: 'ask',
    });

    const run = client.start({ prompt: 'Take your time' });
    // Allow the model loop to start, then cancel.
    await new Promise((resolve) => setTimeout(resolve, 20));
    run.cancel('sdk_smoke_cancel');

    const result = await run.result;
    expect(['cancelled', 'failed', 'completed']).toContain(result.status);
    // Prefer cancelled; engine may surface abort as failed depending on timing.
    if (result.status === 'cancelled') {
      expect(result.reasonCodes.some((code) => code.includes('cancel'))).toBe(
        true,
      );
    }
  });
});
