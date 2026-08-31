import { describe, expect, it } from 'vitest';

import {
  buildContextUsageBreakdown,
  mergePromptBudgetIntoBreakdown,
} from '../src/contextUsage.ts';

describe('contextUsage tree', () => {
  it('builds a parent/child window tree from host sources + preview', () => {
    const breakdown = buildContextUsageBreakdown({
      prompt: 'hello world',
      conversationText: 'prior turn text here',
      repoMapBlock: 'a'.repeat(400),
      gitDiffBlock: 'b'.repeat(200),
      mcpToolsCatalogTokens: 120,
      contextWindow: 35_000,
      preview: {
        maximumOutputTokens: 12_250,
        toolSchemaTokens: 6_000,
        usableInputTokens: 16_750,
        repositoryTokens: 4_000,
        conversationTokens: 6_000,
        planTokens: 1_000,
        skillsTokens: 700,
        systemTokens: 2_000,
      },
    });

    expect(breakdown.source).toBe('host_estimate');
    expect(breakdown.tree).toBeDefined();
    expect(breakdown.tree!.map((node) => node.id)).toEqual([
      'output',
      'tools',
      'usable',
    ]);

    const output = breakdown.tree!.find((node) => node.id === 'output');
    expect(output?.allocatedTokens).toBe(12_250);
    expect(output?.usedTokens).toBe(0);

    const usable = breakdown.tree!.find((node) => node.id === 'usable');
    expect(usable?.children?.some((child) => child.id === 'repository')).toBe(
      true,
    );
    expect(usable?.children?.some((child) => child.id === 'plan')).toBe(true);
    expect(usable?.children?.some((child) => child.id === 'skills')).toBe(true);

    const repository = usable!.children!.find(
      (child) => child.id === 'repository',
    );
    const childIds = (repository?.children ?? []).map((child) => child.id);
    expect(childIds).toContain('repoMap');
    expect(childIds).toContain('gitDiff');
  });

  it('merges prompt_ready budget used/allocated onto the host tree', () => {
    const host = buildContextUsageBreakdown({
      prompt: 'fix auth',
      repoMapBlock: 'map',
      contextWindow: 35_000,
      preview: {
        maximumOutputTokens: 12_250,
        toolSchemaTokens: 6_000,
        usableInputTokens: 16_750,
        repositoryTokens: 4_000,
        conversationTokens: 6_000,
        planTokens: 1_000,
        skillsTokens: 700,
        systemTokens: 2_000,
      },
    });

    const merged = mergePromptBudgetIntoBreakdown({
      host,
      budget: {
        contextWindowTokens: 35_000,
        outputReservedTokens: 12_250,
        inputBudgetTokens: 16_750,
        totalUsedTokens: 5_100,
        withinLimits: true,
        sections: [
          {
            section: 'output_reserve',
            allocatedTokens: 12_250,
            usedTokens: 0,
            omittedTokens: 0,
            truncatedTokens: 0,
          },
          {
            section: 'repository',
            allocatedTokens: 4_000,
            usedTokens: 2_900,
            omittedTokens: 100,
            truncatedTokens: 0,
          },
          {
            section: 'conversation',
            allocatedTokens: 6_000,
            usedTokens: 400,
            omittedTokens: 0,
            truncatedTokens: 0,
          },
          {
            section: 'skills',
            allocatedTokens: 700,
            usedTokens: 220,
            omittedTokens: 0,
            truncatedTokens: 0,
          },
          {
            section: 'tools',
            allocatedTokens: 6_000,
            usedTokens: 1_100,
            omittedTokens: 0,
            truncatedTokens: 0,
          },
          {
            section: 'system',
            allocatedTokens: 2_000,
            usedTokens: 480,
            omittedTokens: 0,
            truncatedTokens: 0,
          },
          {
            section: 'plan',
            allocatedTokens: 1_000,
            usedTokens: 320,
            omittedTokens: 0,
            truncatedTokens: 0,
          },
        ],
      },
      window: {
        toolSchemaTokens: 6_000,
        usableInputTokens: 16_750,
        repositoryTokens: 4_000,
        conversationTokens: 6_000,
        planTokens: 1_000,
        planUsedTokens: 320,
        skillsTokens: 700,
        systemTokens: 2_000,
      },
    });

    expect(merged.source).toBe('prompt_budget');
    expect(merged.estimated).toBe(false);
    expect(merged.totalTokens).toBe(5_100);

    const usable = merged.tree!.find((node) => node.id === 'usable');
    const repository = usable!.children!.find(
      (child) => child.id === 'repository',
    );
    expect(repository?.usedTokens).toBe(2_900);
    expect(repository?.allocatedTokens).toBe(4_000);
    expect(repository?.omittedTokens).toBe(100);

    const skills = usable!.children!.find((child) => child.id === 'skills');
    expect(skills?.usedTokens).toBe(220);
    expect(skills?.allocatedTokens).toBe(700);

    const plan = usable!.children!.find((child) => child.id === 'plan');
    expect(plan?.allocatedTokens).toBe(1_000);
    expect(plan?.usedTokens).toBe(320);
  });

  it('omits plan allocation when no plan content is used', () => {
    const host = buildContextUsageBreakdown({
      prompt: 'hello',
      contextWindow: 32_000,
      preview: {
        toolSchemaTokens: 2_000,
        usableInputTokens: 25_000,
        repositoryTokens: 12_000,
        conversationTokens: 6_000,
        planTokens: 1_000,
        skillsTokens: 1_000,
        systemTokens: 2_000,
      },
    });

    const merged = mergePromptBudgetIntoBreakdown({
      host,
      budget: {
        contextWindowTokens: 32_000,
        outputReservedTokens: 5_000,
        inputBudgetTokens: 25_000,
        totalUsedTokens: 800,
        withinLimits: true,
        sections: [
          {
            section: 'plan',
            allocatedTokens: 0,
            usedTokens: 0,
            omittedTokens: 0,
            truncatedTokens: 0,
          },
        ],
      },
      window: {
        toolSchemaTokens: 2_000,
        usableInputTokens: 25_000,
        repositoryTokens: 12_000,
        conversationTokens: 6_000,
        planTokens: 0,
        planUsedTokens: 0,
        skillsTokens: 1_000,
        systemTokens: 2_000,
      },
    });

    const usable = merged.tree?.find((node) => node.id === 'usable');
    const plan = usable?.children?.find((child) => child.id === 'plan');
    expect(plan?.allocatedTokens).toBe(0);
    expect(plan?.usedTokens).toBe(0);
  });
});
