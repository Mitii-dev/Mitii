import { describe, expect, it } from 'vitest';
import { PLANNING_SCHEMA_VERSION } from '@mitii/sdk';

import {
  buildConversationCarry,
  compactActivityForHistory,
  compactFileChangesForHistory,
  CONVERSATION_CARRY_LIMITS,
  enrichAssistantCarryText,
  parsePendingPlan,
  parsePendingPlanStrategy,
  resolveDisplayedAssistantText,
  resolvePlanHandoff,
  resolvePlanStrategyHandoff,
} from '../src/conversationCarry.ts';

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

  it('hands pending plan strategy only in agent mode', () => {
    const strategy = {
      schemaVersion: 1 as const,
      strategy: 'follow_evidence' as const,
      rationale: 'Repair from diagnostics.',
      skipDiscover: true,
      useBuildEvidence: true,
    };
    expect(
      resolvePlanStrategyHandoff({
        mode: 'plan',
        pendingPlanStrategy: strategy,
      }),
    ).toBeUndefined();
    expect(
      resolvePlanStrategyHandoff({
        mode: 'agent',
        pendingPlanStrategy: strategy,
      })?.strategy,
    ).toBe('follow_evidence');
    expect(parsePendingPlanStrategy({ strategy: 'follow_evidence' })).toBeUndefined();
    expect(parsePendingPlanStrategy(strategy)?.skipDiscover).toBe(true);
  });

  it('enriches incomplete assistant answers with changed-file memory', () => {
    expect(
      enrichAssistantCarryText({
        answer: 'Let me check kitchen-flow.spec.ts more carefully:',
        changedPaths: ['test/a.ts', 'test/b.ts'],
      }),
    ).toBe('Completed workspace edits (2 files changed).');

    expect(
      enrichAssistantCarryText({
        answer:
          'All selector naming is now consistent. Let me run the verification steps from the plan - lint and typecheck:',
        changedPaths: ['test/shared/pages/BasePage.ts'],
      }),
    ).toBe('Completed workspace edits (1 file changed).');

    expect(
      enrichAssistantCarryText({
        answer: 'Removed the old page objects and updated imports.',
        changedPaths: ['test/a.ts'],
      }),
    ).toBe('Removed the old page objects and updated imports.');
  });

  it('keeps streamed text when the final answer is transitional', () => {
    const streamed = [
      "I'll start by discovering the current structure.",
      '',
      'Updated Desktop and Tablet imports, then cleaned unused page objects.',
    ].join('\n');
    expect(
      resolveDisplayedAssistantText({
        streamedText: streamed,
        finalAnswer: 'Let me check kitchen-flow.spec.ts more carefully:',
      }),
    ).toContain('Updated Desktop and Tablet imports');

    expect(
      resolveDisplayedAssistantText({
        streamedText: streamed,
        finalAnswer:
          'Now let me do the same for the Tablet BasePage - delete and recreate it extending the shared base:',
      }),
    ).toContain('Updated Desktop and Tablet imports');

    const fallbackFinal = 'Completed workspace edits (1 file changed).';
    expect(
      resolveDisplayedAssistantText({
        streamedText: streamed,
        finalAnswer:
          'All selector naming is now consistent. Let me run verification:',
      }),
    ).toContain('Updated Desktop and Tablet imports');

    expect(
      resolveDisplayedAssistantText({
        streamedText: streamed,
        finalAnswer: fallbackFinal,
      }),
    ).toContain('Updated Desktop and Tablet imports');

    expect(
      resolveDisplayedAssistantText({
        streamedText: 'Short note',
        finalAnswer:
          'Yes — the old files were removed and imports were updated across specs.',
      }),
    ).toContain('old files were removed');
  });

  it('does not dump mid-work analysis over a verification summary', () => {
    const dump = [
      'Let me analyze the 19 remaining errors:',
      ...Array.from(
        { length: 12 },
        (_, index) =>
          `Let me think about remaining class ${index}. I will apply_patch after I finish this plan.`,
      ),
    ].join('\n');
    const summary =
      'Verification did not go clean. I kept the edits.\n\nBefore: 116 error(s)\nAfter: 24 error(s)';

    expect(
      resolveDisplayedAssistantText({
        streamedText: dump,
        finalAnswer: summary,
      }),
    ).toBe(summary);
    expect(
      enrichAssistantCarryText({
        answer: dump,
        changedPaths: ['packages/mui-builder/src/FormRenderer.tsx'],
      }),
    ).toBe('Completed workspace edits (1 file changed).');
  });

  it('compacts activity and file changes for history', () => {
    const activity = compactActivityForHistory([
      {
        id: '1',
        at: 1,
        kind: 'delta',
        title: 'Writing',
        detail: 'x',
      },
      {
        id: '2',
        at: 2,
        kind: 'tool',
        title: 'Running apply_patch',
        detail: 'paths=a.ts',
        status: 'succeeded',
      },
      {
        id: '3',
        at: 3,
        kind: 'info',
        title: 'Run summary',
      },
    ]);
    expect(activity).toHaveLength(2);
    expect(activity.every((e) => e.kind !== 'delta')).toBe(true);

    const changes = compactFileChangesForHistory({
      runId: 'run_1',
      files: [
        {
          path: 'a.ts',
          additions: 2,
          deletions: 1,
          status: 'M' as const,
          patchPreview: 'huge '.repeat(200),
        },
      ],
      totalAdditions: 2,
      totalDeletions: 1,
    });
    expect(changes?.files[0]?.patchPreview).toBeUndefined();
  });
});
