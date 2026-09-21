import { describe, expect, it } from 'vitest';

import { breakdownFromPromptReady } from '../src/shared/contextUsage.js';

describe('breakdownFromPromptReady', () => {
  it('builds output / tools / usable tree from prompt_ready budget', () => {
    const breakdown = breakdownFromPromptReady({
      type: 'prompt_ready',
      runId: 'r1',
      status: 'ok',
      totalOmittedTokens: 0,
      totalTruncatedTokens: 0,
      budget: {
        contextWindowTokens: 100_000,
        outputReservedTokens: 20_000,
        inputBudgetTokens: 75_000,
        totalUsedTokens: 12_500,
        withinLimits: true,
        sections: [
          {
            section: 'repository',
            allocatedTokens: 40_000,
            usedTokens: 8_000,
            omittedTokens: 100,
            truncatedTokens: 0,
          },
          {
            section: 'conversation',
            allocatedTokens: 20_000,
            usedTokens: 3_000,
            omittedTokens: 0,
            truncatedTokens: 0,
          },
          {
            section: 'skills',
            allocatedTokens: 5_000,
            usedTokens: 500,
            omittedTokens: 0,
            truncatedTokens: 0,
          },
          {
            section: 'system',
            allocatedTokens: 5_000,
            usedTokens: 1_000,
            omittedTokens: 0,
            truncatedTokens: 0,
          },
          {
            section: 'tools',
            allocatedTokens: 5_000,
            usedTokens: 0,
            omittedTokens: 0,
            truncatedTokens: 0,
          },
        ],
      },
      window: {
        toolSchemaTokens: 5_000,
        usableInputTokens: 75_000,
        repositoryTokens: 40_000,
        conversationTokens: 20_000,
        planTokens: 0,
        skillsTokens: 5_000,
        systemTokens: 5_000,
      },
      at: new Date().toISOString(),
    });

    expect(breakdown).not.toBeNull();
    expect(breakdown!.source).toBe('prompt_budget');
    expect(breakdown!.contextWindow).toBe(100_000);
    expect(breakdown!.totalTokens).toBe(12_500);
    expect(breakdown!.tree!.map((n) => n.id)).toEqual([
      'output',
      'tools',
      'usable',
    ]);
    const usable = breakdown!.tree!.find((n) => n.id === 'usable');
    const childIds = usable?.children?.map((c) => c.id) ?? [];
    expect(childIds).toContain('repository');
    expect(childIds).toContain('conversation');
    expect(childIds).toContain('skills');
  });

  it('returns null for non-prompt_ready events', () => {
    expect(breakdownFromPromptReady({ type: 'model_turn' })).toBeNull();
  });
});
