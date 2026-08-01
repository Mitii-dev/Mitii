import { describe, expect, it } from 'vitest';
import {
  AGENT_ENGINE_SCHEMA_VERSION,
  createMitiiClient,
  EchoLlmPort,
  type AgentRunResult,
  type LlmPort,
  type MitiiClient,
  type MitiiResumeInput,
  type MitiiRun,
  type RunEvent,
} from '@mitii/sdk';
import type { ModelCapabilities, ModelEvent, ModelRequest } from '@mitii/v8';

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

describe('CLI driveRun (Phase 15)', () => {
  it('completes an echo ask with streaming status', async () => {
    const client = createMitiiClient({
      understandingLlm: new LocalUnderstandingLlmPort(),
      runLlm: new EchoLlmPort(),
      defaultMode: 'ask',
    });
    const io = memoryIo();
    const outcome = await driveRun({
      client,
      start: { prompt: 'What is recursion?', mode: 'ask' },
      json: true,
      io,
    });
    expect(outcome.exitCode).toBe(0);
    expect(outcome.result.status).toBe('completed');
    expect(outcome.result.answer).toContain('Echo:');
  });

  it('wires interrupt handler to run.cancel', async () => {
    let cancelCalled = false;
    const fakeRun: MitiiRun = {
      runId: 'run_cancel',
      events: (async function* (): AsyncGenerator<RunEvent> {
        yield {
          type: 'stage_started',
          runId: 'run_cancel',
          stage: 'received',
          at: new Date().toISOString(),
        };
      })(),
      result: Promise.resolve({
        schemaVersion: AGENT_ENGINE_SCHEMA_VERSION,
        runId: 'run_cancel',
        requestId: 'req',
        status: 'cancelled',
        reasonCodes: ['cancelled'],
        warnings: [],
        usage: { modelCalls: 0, toolCalls: 0, loopIterations: 0 },
        durationMs: 1,
      } satisfies AgentRunResult),
      cancel: () => {
        cancelCalled = true;
      },
    };

    const client = {
      start: () => fakeRun,
      resume: (_input: MitiiResumeInput) => fakeRun,
    } as unknown as MitiiClient;

    let interruptHandler: (() => void) | undefined;
    const io = memoryIo();
    io.onInterrupt = (handler) => {
      interruptHandler = handler;
      return () => {
        interruptHandler = undefined;
      };
    };

    const pending = driveRun({
      client,
      start: { prompt: 'slow', mode: 'ask' },
      json: true,
      io,
    });

    // Allow the event loop to register the handler, then fire it.
    await Promise.resolve();
    interruptHandler?.();

    const outcome = await pending;
    expect(cancelCalled).toBe(true);
    expect(outcome.result.status).toBe('cancelled');
    expect(outcome.exitCode).toBe(130);
  });
});
