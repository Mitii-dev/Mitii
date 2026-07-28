import { describe, expect, it } from 'vitest';
import { PLANNING_SCHEMA_VERSION } from '@mitii/sdk';

import {
  buildConversationCarry,
  CONVERSATION_CARRY_LIMITS,
  parsePendingPlan,
  resolvePlanHandoff,
} from '../../../apps/vscode/src/conversationCarry.ts';

function samplePlan(objective = 'Carry plan') {
  return {
    schemaVersion: PLANNING_SCHEMA_VERSION,
    objective,
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
            expectedOutcome: 'Outcome',
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

describe('conversationCarry (VS Code host)', () => {
  it('maps prior turns and excludes the live prompt when mirrored', () => {
    const carried = buildConversationCarry({
      messages: [
        { role: 'user', text: 'First' },
        { role: 'assistant', text: 'Reply one' },
        { role: 'user', text: 'Do the plan' },
      ],
      currentPrompt: 'Do the plan',
    });

    expect(carried).toEqual([
      { role: 'user', content: 'First' },
      { role: 'assistant', content: 'Reply one' },
    ]);
  });

  it('windows to maxMessages and truncates long turns', () => {
    const messages = Array.from({ length: 30 }, (_, i) => ({
      role: (i % 2 === 0 ? 'user' : 'assistant') as 'user' | 'assistant',
      text: `turn-${i}-${'x'.repeat(100)}`,
    }));

    const carried = buildConversationCarry({
      messages,
      limits: { maxMessages: 4, maxCharsPerMessage: 20 },
    });

    expect(carried).toHaveLength(4);
    expect(carried.every((m) => m.content.length <= 20)).toBe(true);
    expect(carried[0]?.content.startsWith('turn-26')).toBe(true);
  });

  it('uses default limits from policy constants', () => {
    expect(CONVERSATION_CARRY_LIMITS.maxMessages).toBeGreaterThan(0);
    expect(CONVERSATION_CARRY_LIMITS.maxCharsPerMessage).toBeGreaterThan(0);
  });

  it('hands pending plan only in agent mode', () => {
    const plan = samplePlan();
    expect(
      resolvePlanHandoff({ mode: 'plan', pendingPlan: plan }),
    ).toBeUndefined();
    expect(
      resolvePlanHandoff({ mode: 'ask', pendingPlan: plan }),
    ).toBeUndefined();
    expect(
      resolvePlanHandoff({ mode: 'agent', pendingPlan: plan })?.objective,
    ).toBe('Carry plan');
  });

  it('rejects invalid persisted plan shapes', () => {
    expect(parsePendingPlan({ objective: 'missing fields' })).toBeUndefined();
    expect(parsePendingPlan(samplePlan('Valid'))?.objective).toBe('Valid');
  });
});
