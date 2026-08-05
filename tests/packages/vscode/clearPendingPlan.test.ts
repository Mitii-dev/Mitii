import { describe, expect, it, vi } from 'vitest';
import { PLANNING_SCHEMA_VERSION } from '@mitii/sdk';

import { clearPendingPlan } from '../../../apps/vscode/src/chatHistory.ts';

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
    expect(state.update).toHaveBeenCalled();
  });
});
