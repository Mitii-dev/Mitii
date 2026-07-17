import { describe, expect, it } from 'vitest';
import {
  buildSystemPrompt,
  buildPrompt,
  buildIsolatedPlanPrompt,
  buildPlanningDiscoveryPrompt,
  collectSystemPromptSections,
  describePromptSections,
} from '../src/core/plans/promptBuilder';
import {
  resolvePlanningDepth,
  shouldSkipStructuredPlanner,
  maxStepsForPlanningDepth,
  minStepsForPlanningDepth,
} from '../src/core/plans/planningDepth';
import { shouldUsePlannerForAct } from '../src/core/modes/agent/ActIntentRouter';
import type { TaskAnalysis } from '../src/core/runtime/TaskAnalyzer';
import type { ContextPack } from '../src/core/context/types';

function emptyPack(overrides: Partial<ContextPack> = {}): ContextPack {
  return {
    items: [],
    totalTokens: 0,
    formatted: 'full formatted context that should not always appear',
    retrievedCount: 0,
    budgetLimit: 100,
    dropped: [],
    truncatedCount: 0,
    ...overrides,
  };
}

describe('planningDepth', () => {
  it('maps task kinds to skill-aligned depths', () => {
    expect(resolvePlanningDepth({ kind: 'simple_edit', complexity: 'low', shouldPlan: false, shouldVerify: false, shouldUseSubagents: false, summary: 'rename' })).toBe('micro');
    expect(resolvePlanningDepth({ kind: 'question', complexity: 'low', shouldPlan: false, shouldVerify: false, shouldUseSubagents: false, summary: 'where' })).toBe('none');
    expect(resolvePlanningDepth({ kind: 'implementation', complexity: 'low', shouldPlan: true, shouldVerify: true, shouldUseSubagents: false, summary: 'add' })).toBe('short');
    expect(resolvePlanningDepth({ kind: 'audit', complexity: 'high', shouldPlan: true, shouldVerify: true, shouldUseSubagents: false, summary: 'unused' })).toBe('full');
  });

  it('skips structured planner for none/micro in Agent mode only', () => {
    expect(shouldSkipStructuredPlanner('none', 'agent')).toBe(true);
    expect(shouldSkipStructuredPlanner('micro', 'agent')).toBe(true);
    expect(shouldSkipStructuredPlanner('standard', 'agent')).toBe(false);
    expect(shouldSkipStructuredPlanner('micro', 'plan')).toBe(false);
  });

  it('enforces depth budgets', () => {
    expect(maxStepsForPlanningDepth('micro')).toBe(2);
    expect(maxStepsForPlanningDepth('short')).toBe(4);
    expect(minStepsForPlanningDepth('micro')).toBe(1);
    expect(minStepsForPlanningDepth('standard', { kind: 'implementation', complexity: 'medium', shouldPlan: true, shouldVerify: true, shouldUseSubagents: false, summary: 'x' })).toBe(2);
  });
});

describe('prompt routing hygiene', () => {
  it('does not inject docs or MDX guidance by default', () => {
    const prompt = buildSystemPrompt('agent', true);
    expect(prompt).not.toContain('DOCUMENTATION TASKS');
    expect(prompt).not.toContain('LiveCodeBlock');
    expect(prompt).toContain('TRUST BOUNDARY');
    expect(prompt).toContain('inspect the minimum code');
  });

  it('injects docs and MDX only when routed', () => {
    const docs = buildSystemPrompt('agent', true, { docsMode: true });
    expect(docs).toContain('DOCUMENTATION TASKS');
    expect(docs).not.toContain('LiveCodeBlock');

    const mdx = buildSystemPrompt('agent', true, { mdxRepairMode: true });
    expect(mdx).toContain('LiveCodeBlock');
  });

  it('wraps workspace context as untrusted evidence', () => {
    const messages = buildPrompt(
      'agent',
      emptyPack(),
      'fix the bug',
      [],
      true
    );
    const user = messages.at(-1)?.content ?? '';
    expect(user).toContain('<workspace_context trust="untrusted-data">');
    expect(user).toContain('<user_request trust="instruction">');
  });

  it('reports active prompt sections for telemetry', () => {
    const sections = collectSystemPromptSections('agent', true, {
      auditMode: true,
      docsMode: false,
      mdxRepairMode: false,
      isContinuation: false,
    });
    expect(describePromptSections(sections)).toEqual(
      expect.arrayContaining(['stable_core', 'mode', 'tools', 'act_skill_guidance', 'audit', 'rules'])
    );
  });

  it('keeps discovery context slim and subagent-gated', () => {
    const pack = emptyPack({
      items: [
        {
          id: 'repo-map',
          source: 'repo-map',
          reason: 'repo map',
          content: 'apps/\npackages/',
          tokenEstimate: 10,
          score: 1,
        },
        {
          id: 'a',
          source: 'file',
          reason: 'hit',
          relPath: 'src/a.ts',
          content: 'const x = 1;\n'.repeat(200),
          tokenEstimate: 40,
          score: 0.8,
        },
      ],
      formatted: 'HUGE FULL FORMATTED PACK',
    });
    const messages = buildPlanningDiscoveryPrompt('plan', pack, 'plan a feature', {
      kind: 'implementation',
      complexity: 'medium',
      summary: 'feature',
    }, { subagentsEnabled: false });
    const user = messages.at(-1)?.content ?? '';
    expect(user).not.toContain('HUGE FULL FORMATTED PACK');
    expect(user).toContain('Planning stage context (discovery)');
    expect(messages[0]?.content).toContain('Subagents are unavailable');
  });

  it('uses depth budgets in isolated plan compilation', () => {
    const messages = buildIsolatedPlanPrompt(
      'agent',
      emptyPack({
        items: [{ id: 'repo', source: 'repo-map', reason: 'repo', content: 'map', tokenEstimate: 2, score: 1 }],
      }),
      'add a button',
      undefined,
      undefined,
      { kind: 'implementation', complexity: 'low', planningDepth: 'short' }
    );
    expect(messages[0]?.content).toContain('Use 2-4 steps maximum');
    expect(messages[0]?.content).not.toContain('8-12 granular steps');
  });
});

describe('act planner gating', () => {
  it('disables planner for micro-depth tasks even when shouldPlan is true', () => {
    const analysis: TaskAnalysis = {
      kind: 'simple_edit',
      complexity: 'low',
      shouldPlan: true,
      shouldVerify: true,
      shouldUseSubagents: false,
      summary: 'rename variable',
    };
    expect(shouldUsePlannerForAct(analysis, true)).toBe(false);
  });
});
