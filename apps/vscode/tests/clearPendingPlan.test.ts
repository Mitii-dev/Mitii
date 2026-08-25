import { describe, expect, it, vi } from 'vitest';
import { PLANNING_SCHEMA_VERSION } from '@mitii/sdk';

import {
  appendTurn,
  clearPendingPlan,
  loadHistory,
} from '../src/chatHistory.ts';

function samplePlan() {
  return {
    schemaVersion: PLANNING_SCHEMA_VERSION,
    objective: 'Pending plan',
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
        id: 'phase-1',
        name: 'Phase',
        purpose: 'Purpose',
        steps: [
          {
            id: 'step-1',
            intent: 'Intent',
            targetRefs: [],
            actionSummary: 'Summary',
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
}

describe('clearPendingPlan', () => {
  it('removes pendingPlan from the active thread', async () => {
    const store = {
      activeThreadId: 't1',
      threads: [
        {
          id: 't1',
          title: 'Plan chat',
          updatedAt: new Date().toISOString(),
          messages: [],
          pendingPlan: samplePlan(),
          pendingPlanStrategy: {
            schemaVersion: 1,
            strategy: 'follow_evidence',
            rationale: 'Repair from diagnostics.',
            skipDiscover: true,
            useBuildEvidence: true,
          },
        },
      ],
    };

    const state = {
      get: vi.fn((key: string) =>
        key === 'mitii.chatHistory.v1' ? store : undefined,
      ),
      update: vi.fn(async (_key: string, value: unknown) => {
        Object.assign(store, value);
      }),
      keys: () => [] as readonly string[],
    };

    const next = await clearPendingPlan(state as never, 't1');
    expect(next.threads[0]?.pendingPlan).toBeUndefined();
    expect(next.threads[0]?.pendingPlanStrategy).toBeUndefined();
    expect(state.update).toHaveBeenCalled();
  });

  it('persists and reloads pendingPlanStrategy with the pending plan', async () => {
    const store = {
      activeThreadId: undefined as string | undefined,
      threads: [] as Array<Record<string, unknown>>,
    };
    const state = {
      get: vi.fn((key: string) =>
        key === 'mitii.chatHistory.v1' ? store : undefined,
      ),
      update: vi.fn(async (_key: string, value: unknown) => {
        Object.assign(store, value);
      }),
      keys: () => [] as readonly string[],
    };

    await appendTurn(state as never, {
      userText: 'Fix the type errors',
      assistantText: 'Here is the plan.',
      mode: 'plan',
      pendingPlan: samplePlan(),
      pendingPlanStrategy: {
        schemaVersion: 1,
        strategy: 'follow_evidence',
        rationale: 'Repair from diagnostics.',
        skipDiscover: true,
        useBuildEvidence: true,
      },
    });

    const reloaded = loadHistory(state as never);
    expect(reloaded.threads[0]?.pendingPlan?.objective).toBe('Pending plan');
    expect(reloaded.threads[0]?.pendingPlanStrategy?.strategy).toBe(
      'follow_evidence',
    );
  });

  it('drops a stale pendingPlanStrategy shape on reload', () => {
    const store = {
      activeThreadId: 't1',
      threads: [
        {
          id: 't1',
          title: 'Plan chat',
          updatedAt: new Date().toISOString(),
          messages: [],
          pendingPlan: samplePlan(),
          pendingPlanStrategy: { strategy: 'follow_evidence' },
        },
      ],
    };
    const state = {
      get: vi.fn((key: string) =>
        key === 'mitii.chatHistory.v1' ? store : undefined,
      ),
      update: vi.fn(),
      keys: () => [] as readonly string[],
    };

    const loaded = loadHistory(state as never);
    expect(loaded.threads[0]?.pendingPlan?.objective).toBe('Pending plan');
    expect(loaded.threads[0]?.pendingPlanStrategy).toBeUndefined();
  });
});
