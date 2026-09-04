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

  it('emits suspended JSON under --approve without prompting for clarification', async () => {
    const suspended: AgentRunResult = {
      schemaVersion: AGENT_ENGINE_SCHEMA_VERSION,
      runId: 'run_clarify_json',
      requestId: 'req_clarify',
      status: 'suspended',
      reasonCodes: ['clarification_suspended'],
      warnings: [],
      usage: { modelCalls: 0, toolCalls: 0, loopIterations: 0 },
      durationMs: 1,
      suspension: {
        kind: 'clarification_required',
        rationale: 'Need outcome',
        clarificationPrompt: 'What outcome do you want from this request?',
      },
    };

    let promptCalls = 0;
    let resumeCalls = 0;
    const fakeRun: MitiiRun = {
      runId: 'run_clarify_json',
      events: (async function* (): AsyncGenerator<RunEvent> {
        yield {
          type: 'suspended',
          runId: 'run_clarify_json',
          kind: 'clarification_required',
          rationale: 'Need outcome',
          at: new Date().toISOString(),
        };
      })(),
      result: Promise.resolve(suspended),
      cancel: () => undefined,
    };

    const client = {
      start: () => fakeRun,
      resume: (_input: MitiiResumeInput) => {
        resumeCalls += 1;
        return fakeRun;
      },
    } as unknown as MitiiClient;

    const io = memoryIo();
    io.prompt = async () => {
      promptCalls += 1;
      return 'should not be asked';
    };

    const outcome = await driveRun({
      client,
      start: { prompt: 'Add app/error.tsx', mode: 'agent' },
      json: true,
      autoApproval: 'approved',
      io,
    });

    expect(promptCalls).toBe(0);
    expect(resumeCalls).toBe(0);
    expect(outcome.result.status).toBe('suspended');
    expect(outcome.exitCode).toBe(0);
    expect(io.stdout.join('')).toContain('"status":"suspended"');
  });

  it('auto-resumes plan_approval_required under --approve in JSON mode', async () => {
    const suspended: AgentRunResult = {
      schemaVersion: AGENT_ENGINE_SCHEMA_VERSION,
      runId: 'run_plan_json',
      requestId: 'req_plan',
      status: 'suspended',
      reasonCodes: ['plan_approval_suspended'],
      warnings: [],
      usage: { modelCalls: 0, toolCalls: 0, loopIterations: 0 },
      durationMs: 1,
      suspension: {
        kind: 'plan_approval_required',
        rationale: 'A reviewable plan is required before mutation.',
      },
    };
    const completed: AgentRunResult = {
      ...suspended,
      status: 'completed',
      reasonCodes: ['plan_approved', 'answer_produced'],
      suspension: undefined,
      answer: 'done',
    };

    let resumeInput: MitiiResumeInput | undefined;
    const suspendedRun: MitiiRun = {
      runId: 'run_plan_json',
      events: (async function* (): AsyncGenerator<RunEvent> {
        yield {
          type: 'suspended',
          runId: 'run_plan_json',
          kind: 'plan_approval_required',
          rationale: 'A reviewable plan is required before mutation.',
          at: new Date().toISOString(),
        };
      })(),
      result: Promise.resolve(suspended),
      cancel: () => undefined,
    };
    const completedRun: MitiiRun = {
      runId: 'run_plan_json',
      events: (async function* (): AsyncGenerator<RunEvent> {
        yield {
          type: 'stage_completed',
          runId: 'run_plan_json',
          stage: 'completed',
          at: new Date().toISOString(),
        };
      })(),
      result: Promise.resolve(completed),
      cancel: () => undefined,
    };

    const client = {
      start: () => suspendedRun,
      resume: (input: MitiiResumeInput) => {
        resumeInput = input;
        return completedRun;
      },
    } as unknown as MitiiClient;

    const io = memoryIo();
    const outcome = await driveRun({
      client,
      start: { prompt: 'Add a Nest pipe', mode: 'agent' },
      json: true,
      autoApproval: 'approved',
      io,
    });

    expect(resumeInput).toEqual({
      schemaVersion: AGENT_ENGINE_SCHEMA_VERSION,
      runId: 'run_plan_json',
      planDecision: { decision: 'approved' },
    });
    expect(outcome.result.status).toBe('completed');
    expect(outcome.exitCode).toBe(0);
  });
});
