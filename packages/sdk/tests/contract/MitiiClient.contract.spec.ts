import { describe, expect, it } from 'vitest';
import type { LlmPort, ModelCapabilities, ModelEvent, ModelRequest } from '@mitii/v8';
import { EchoLlmPort } from '@mitii/v8';

import {
  MitiiSdkError,
  createMitiiClient,
  isRunEvent,
  isTerminalRunEvent,
  mitiiResumeInputSchema,
  mitiiStartInputSchema,
  runEventSchema,
} from '@mitii/sdk';

class UnderstandingLlmPort implements LlmPort {
  readonly id = 'sdk-understanding';
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

describe('MitiiClient contract (Phase 12)', () => {
  it('rejects invalid start input with MitiiSdkError invalid_input', () => {
    const client = createMitiiClient({
      understandingLlm: new UnderstandingLlmPort({
        interactionIntent: 'question',
        primaryTaskIntent: 'question',
        needsClarification: false,
        confidence: 0.9,
        alternatives: [],
        secondaryTaskIntents: [],
        reason: 'test',
      }),
      runLlm: new EchoLlmPort(),
    });

    expect(() => client.start({ prompt: '' })).toThrow(MitiiSdkError);
    try {
      client.start({ prompt: '' });
    } catch (error) {
      expect(error).toBeInstanceOf(MitiiSdkError);
      expect((error as MitiiSdkError).code).toBe('invalid_input');
    }

    expect(mitiiStartInputSchema.safeParse({ prompt: '' }).success).toBe(false);
    expect(mitiiStartInputSchema.safeParse({ prompt: 'ok' }).success).toBe(true);
    expect(
      mitiiStartInputSchema.safeParse({
        prompt: 'ok',
        approvalMode: 'never',
        planApproval: 'never',
      }).success,
    ).toBe(true);
  });

  it('rejects resume without approval or clarificationAnswer', () => {
    const parsed = mitiiResumeInputSchema.safeParse({
      schemaVersion: 1,
      runId: 'run_1',
    });
    expect(parsed.success).toBe(false);
  });

  it('discriminates run events via schema helpers', () => {
    const terminal = {
      type: 'terminal',
      runId: 'run_1',
      status: 'completed',
      result: {
        schemaVersion: 1,
        runId: 'run_1',
        requestId: 'req_1',
        status: 'completed',
        reasonCodes: ['answer_produced'],
        warnings: [],
        usage: {
          modelCalls: 1,
          toolCalls: 0,
          loopIterations: 1,
        },
        durationMs: 10,
      },
      at: '2026-07-26T12:00:00.000Z',
    };
    expect(isRunEvent(terminal)).toBe(true);
    expect(isTerminalRunEvent(runEventSchema.parse(terminal))).toBe(true);
    expect(isRunEvent({ type: 'not_a_real_event' })).toBe(false);
  });
});
