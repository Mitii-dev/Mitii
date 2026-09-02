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
  toAgentEngineStartInput,
  PLANNING_SCHEMA_VERSION,
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
        budget: {
          unlimited: true,
          maxModelCalls: 1_000_000,
          maxToolCalls: 1_000_000,
          maxLoopIterations: 1_000_000,
          maxWallTimeMs: 60_000,
        },
      }).success,
    ).toBe(true);
    expect(
      mitiiStartInputSchema.safeParse({
        prompt: 'ok',
        approvalMode: 'never',
        planApproval: 'never',
      }).success,
    ).toBe(true);
    expect(
      mitiiStartInputSchema.safeParse({
        prompt: 'continue',
        conversation: [
          { role: 'user', content: 'prior' },
          { role: 'assistant', content: 'reply' },
        ],
      }).success,
    ).toBe(true);
    expect(
      mitiiStartInputSchema.safeParse({
        prompt: 'continue',
        conversation: [{ role: 'system', content: 'nope' }],
      }).success,
    ).toBe(false);
  });

  it('maps conversation and approvedPlan onto engine start input', () => {
    const plan = {
      schemaVersion: PLANNING_SCHEMA_VERSION,
      objective: 'Handoff plan',
      assumptions: [],
      openQuestions: [],
      contextReviewed: [],
      constraints: [],
      dimensions: {
        scope: 'module',
        risk: 'low' as const,
        clarity: 'clear',
        complexity: 'simple',
        changeImpact: ['code' as const],
      },
      phases: [
        {
          id: 'p1',
          name: 'One',
          purpose: 'Do it',
          steps: [
            {
              id: 's1',
              intent: 'Implement',
              targetRefs: [],
              actionSummary: 'Write code',
              expectedOutcome: 'Done',
              riskLevel: 'low' as const,
            },
          ],
          dependencies: [],
          successCriteria: [],
        },
      ],
      risks: [],
      alternatives: [],
      verification: { checks: [], manualQa: [], commands: [] },
      approvalRequired: false,
      processHintsApplied: [],
    };

    const engineInput = toAgentEngineStartInput(
      {
        prompt: 'Execute it',
        mode: 'agent',
        conversation: [
          { role: 'user', content: 'Plan auth' },
          { role: 'assistant', content: 'Phases…' },
        ],
        approvedPlan: plan,
        approvedPlanStrategy: {
          schemaVersion: 1,
          strategy: 'follow_evidence',
          rationale: 'Host-carried repair plan.',
          skipDiscover: true,
          useBuildEvidence: true,
        },
      },
      { mode: 'ask', sessionId: 'sess_test' },
    );

    expect(engineInput.conversation).toHaveLength(2);
    expect(engineInput.conversation[0]).toEqual({
      role: 'user',
      content: 'Plan auth',
    });
    expect(engineInput.approvedPlan?.objective).toBe('Handoff plan');
    expect(engineInput.approvedPlanStrategy?.strategy).toBe('follow_evidence');
    expect(engineInput.approvedPlanStrategy?.skipDiscover).toBe(true);
    expect(engineInput.request.userMessage).toBe('Execute it');
    expect(engineInput.request.mode).toBe('agent');
  });

  it('maps a carried taskList onto engine start input', () => {
    const engineInput = toAgentEngineStartInput(
      {
        prompt: 'Continue',
        mode: 'agent',
        taskList: {
          schemaVersion: 1,
          source: 'agent',
          items: [
            { id: 'one', title: 'Read module', status: 'done' },
            { id: 'two', title: 'Write fix', status: 'pending' },
          ],
        },
      },
      { mode: 'ask', sessionId: 'sess_test' },
    );
    expect(engineInput.taskList?.items).toHaveLength(2);
    expect(engineInput.taskList?.items[0]?.status).toBe('done');
  });

  it('maps pinnedPaths to referencedArtifacts with robust kind inference', () => {
    const engineInput = toAgentEngineStartInput(
      {
        prompt: 'Inspect pinned context',
        mode: 'ask',
        pinnedPaths: [
          'packages/core',
          'apps/docs/README.md',
          'Makefile',
          'backend/api/',
          'packages.legacy',
        ],
      },
      { mode: 'ask', sessionId: 'sess_test' },
    );

    const artifacts = engineInput.request.referencedArtifacts ?? [];
    expect(artifacts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: 'packages/core', kind: 'folder' }),
        expect.objectContaining({
          path: 'apps/docs/README.md',
          kind: 'file',
        }),
        expect.objectContaining({ path: 'Makefile', kind: 'file' }),
        expect.objectContaining({ path: 'backend/api', kind: 'folder' }),
        expect.objectContaining({ path: 'packages.legacy', kind: 'folder' }),
      ]),
    );
  });

  it('maps windowBudget policy overrides onto engine start input', () => {
    const engineInput = toAgentEngineStartInput(
      {
        prompt: 'Tune the window',
        windowBudget: {
          policy: {
            outputRatio: 0.12,
            repositoryShare: 0.3,
          },
        },
      },
      { mode: 'ask', sessionId: 'sess_test' },
    );
    expect(engineInput.windowBudget?.policy?.outputRatio).toBe(0.12);
    expect(engineInput.windowBudget?.policy?.repositoryShare).toBe(0.3);
  });

  it('maps windowBudget effort onto engine start input', () => {
    const engineInput = toAgentEngineStartInput(
      {
        prompt: 'Use a larger working set',
        windowBudget: {
          effort: 'high',
        },
      },
      { mode: 'ask', sessionId: 'sess_test' },
    );
    expect(engineInput.windowBudget?.effort).toBe('high');
  });

  it('maps windowBudget maximumOutputTokens onto engine start input', () => {
    const engineInput = toAgentEngineStartInput(
      {
        prompt: 'Cap generation',
        windowBudget: {
          maximumOutputTokens: 18_000,
        },
      },
      { mode: 'ask', sessionId: 'sess_test' },
    );
    expect(engineInput.windowBudget?.maximumOutputTokens).toBe(18_000);
  });

  it('maps loopPolicy threshold overrides onto engine start input', () => {
    const engineInput = toAgentEngineStartInput(
      {
        prompt: 'fix it',
        loopPolicy: {
          thresholds: {
            explorationRereadMinCalls: 24,
            explorationRereadRatio: 3,
            maxExplorationStallNudges: 3,
          },
        },
      },
      { mode: 'agent', sessionId: 'sess_test' },
    );
    expect(engineInput.loopPolicy?.thresholds?.explorationRereadMinCalls).toBe(
      24,
    );
    expect(engineInput.loopPolicy?.thresholds?.explorationRereadRatio).toBe(3);
    expect(engineInput.loopPolicy?.thresholds?.maxExplorationStallNudges).toBe(
      3,
    );
  });

  it('keeps loopPolicy thresholds as lab overrides for window-band merge', () => {
    const engineInput = toAgentEngineStartInput(
      {
        prompt: 'fix it',
        loopPolicy: {
          thresholds: {
            maxReadOnlyToolTurnsBeforeMutationNudge: 14,
          },
        },
      },
      { mode: 'agent', sessionId: 'sess_band' },
    );
    expect(
      engineInput.loopPolicy?.thresholds?.maxReadOnlyToolTurnsBeforeMutationNudge,
    ).toBe(14);
    expect(
      engineInput.loopPolicy?.thresholds?.explorationRereadMinCalls,
    ).toBeUndefined();
  });

  it('maps origin, autonomyPreset, and correlation onto engine start input', () => {
    const engineInput = toAgentEngineStartInput(
      {
        prompt: 'Cover the latest commit with tests',
        origin: 'automation',
        autonomyPreset: 'apply_and_pr',
        correlation: {
          traceId: 'trace_ci_1',
          clientRequestId: 'gha_run_99',
        },
      },
      { mode: 'ask', sessionId: 'sess_auto' },
    );
    expect(engineInput.request.origin).toBe('automation');
    expect(engineInput.request.mode).toBe('agent');
    expect(engineInput.approvalMode).toBe('never');
    expect(engineInput.planApproval).toBe('never');
    expect(engineInput.request.correlation).toEqual({
      traceId: 'trace_ci_1',
      clientRequestId: 'gha_run_99',
    });
  });

  it('lets explicit mode override autonomyPreset mode', () => {
    const engineInput = toAgentEngineStartInput(
      {
        prompt: 'Only plan',
        autonomyPreset: 'apply',
        mode: 'plan',
      },
      { mode: 'ask', sessionId: 'sess_override' },
    );
    expect(engineInput.request.mode).toBe('plan');
    expect(engineInput.approvalMode).toBe('never');
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
