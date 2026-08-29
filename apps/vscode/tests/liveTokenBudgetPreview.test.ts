import { describe, expect, it } from 'vitest';

import {
  deriveLiveTokenBudgetPreview,
  isFilesPerMutationPinned,
  isVerificationChecksPinned,
  mergeLiveWindowBudgetPolicy,
  policyForFilesPerMutation,
  policyForVerificationChecks,
  resolvePreviewContextWindow,
  safeSliderValue,
  windowAllocationSlices,
} from '../src/liveTokenBudgetPreview';
import { defaultTokenBudgetSettings } from '../src/tokenBudgetSettings';

describe('live token budget preview', () => {
  it('matches the host Window Budget derivation for common windows', () => {
    for (const windowTokens of [30_000, 48_000, 60_000, 200_000]) {
      const live = deriveLiveTokenBudgetPreview({
        contextWindowTokens: windowTokens,
      });
      const host = defaultTokenBudgetSettings(windowTokens).preview;
      expect(live.contextWindowTokens).toBe(host.contextWindowTokens);
      expect(live.maximumOutputTokens).toBe(host.maximumOutputTokens);
      expect(live.toolSchemaTokens).toBe(host.toolSchemaTokens);
      expect(live.usableInputTokens).toBe(host.usableInputTokens);
      expect(live.repositoryTokens).toBe(host.repositoryTokens);
      expect(live.conversationTokens).toBe(host.conversationTokens);
      expect(live.planTokens).toBe(host.planTokens);
      expect(live.skillsTokens).toBe(host.skillsTokens);
      expect(live.systemTokens).toBe(host.systemTokens);
      expect(live.maxUniqueFilesPerCall).toBe(host.maxUniqueFilesPerCall);
      expect(live.maxVerificationChecks).toBe(host.maxVerificationChecks);
      expect(live.maxTasks).toBe(host.maxTasks);
    }
  });

  it('scales files per mutation with the context window until the value is pinned', () => {
    const at30k = deriveLiveTokenBudgetPreview({
      contextWindowTokens: 30_000,
    });
    const at60k = deriveLiveTokenBudgetPreview({
      contextWindowTokens: 60_000,
    });
    expect(at60k.maxUniqueFilesPerCall).toBeGreaterThan(
      at30k.maxUniqueFilesPerCall,
    );

    const pinned = policyForFilesPerMutation(at30k.maxUniqueFilesPerCall);
    expect(isFilesPerMutationPinned(pinned)).toBe(true);
    const pinnedAt60k = deriveLiveTokenBudgetPreview({
      contextWindowTokens: 60_000,
      policy: pinned,
    });
    expect(pinnedAt60k.maxUniqueFilesPerCall).toBe(at30k.maxUniqueFilesPerCall);
  });

  it('keeps unpinned verification checks scaling and pinned checks stable', () => {
    const at30k = deriveLiveTokenBudgetPreview({
      contextWindowTokens: 30_000,
    });
    const pinned = policyForVerificationChecks(5);
    expect(isVerificationChecksPinned(pinned)).toBe(true);
    const pinnedAt200k = deriveLiveTokenBudgetPreview({
      contextWindowTokens: 200_000,
      policy: pinned,
    });
    expect(pinnedAt200k.maxVerificationChecks).toBe(5);
    expect(at30k.maxVerificationChecks).not.toBe(5);
  });

  it('shows each module as a percent of the current context window', () => {
    const preview = deriveLiveTokenBudgetPreview({
      contextWindowTokens: 48_000,
    });
    const slices = windowAllocationSlices(preview);
    const totalShare = slices.reduce((sum, slice) => sum + slice.windowShare, 0);
    const totalTokens = slices.reduce((sum, slice) => sum + slice.tokens, 0);
    expect(slices.map((slice) => slice.id)).toEqual([
      'output',
      'tools',
      'repository',
      'conversation',
      'plan',
      'skills',
      'system',
    ]);
    expect(totalTokens).toBe(preview.contextWindowTokens);
    expect(totalShare).toBeCloseTo(1, 5);
    const repository = slices.find((slice) => slice.id === 'repository');
    expect(repository?.windowShare).toBeGreaterThan(0);
    expect(repository?.windowShare).toBeLessThan(0.5);
  });

  it('ignores non-finite policy overrides so sliders never receive NaN', () => {
    const merged = mergeLiveWindowBudgetPolicy({
      outputRatio: Number.NaN,
      repositoryShare: Number.POSITIVE_INFINITY,
      conversationShare: undefined as unknown as number,
    });
    expect(merged.outputRatio).toBe(0.2);
    expect(merged.repositoryShare).toBe(0.28);
    expect(safeSliderValue(Number.NaN, 1, 20)).toBe(1);
    expect(safeSliderValue(50, 1, 20)).toBe(20);
    expect(safeSliderValue(0, 1, 16)).toBe(1);
  });

  it('uses a typed context-window draft before Save, and 0 falls back to the model preset', () => {
    expect(
      resolvePreviewContextWindow({
        draft: 16_000,
        stored: 30_000,
        effective: 262_144,
        fallback: 32_768,
      }),
    ).toBe(16_000);
    expect(
      resolvePreviewContextWindow({
        draft: 0,
        stored: 0,
        effective: 262_144,
        fallback: 32_768,
      }),
    ).toBe(262_144);
    expect(
      resolvePreviewContextWindow({
        stored: 48_000,
        effective: 262_144,
        fallback: 32_768,
      }),
    ).toBe(48_000);
  });
});
