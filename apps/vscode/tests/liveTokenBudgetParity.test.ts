import { describe, expect, it } from 'vitest';
import { deriveLiveTokenBudgetPreview } from '@mitii/ui-core';

import { defaultTokenBudgetSettings } from '../src/tokenBudgetSettings';

describe('live token budget preview parity', () => {
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
      expect(live.carryMaxMessages).toBe(host.carryMaxMessages);
      expect(live.carryMaxCharsPerMessage).toBe(host.carryMaxCharsPerMessage);
      expect(live.injectionRepoMapChars).toBe(host.injectionRepoMapChars);
    }
  });
});
