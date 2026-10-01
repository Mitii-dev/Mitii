import { describe, expect, it } from 'vitest';

import {
  DEFAULT_CONTEXT_WINDOW,
  inferContextWindowFromModelId,
  parseContextWindowTokens,
  resolveEffectiveContextWindow,
  resolveHostContextWindowTokens,
} from './resolveEffectiveContextWindow.js';

describe('inferContextWindowFromModelId', () => {
  it('reads Nk tags from model ids', () => {
    expect(inferContextWindowFromModelId('my-qwen-64k:latest')).toBe(65_536);
    expect(inferContextWindowFromModelId('qwen3:32k')).toBe(32_768);
  });

  it('reads bare token budgets when unambiguous', () => {
    expect(inferContextWindowFromModelId('local-model:65536')).toBe(65_536);
  });
});

describe('resolveEffectiveContextWindow', () => {
  it('prefers explicit stored window', () => {
    expect(resolveEffectiveContextWindow(100_000, 'my-qwen-64k:latest')).toBe(
      100_000,
    );
  });

  it('falls back to model tag when stored is auto', () => {
    expect(resolveEffectiveContextWindow(0, 'my-qwen-64k:latest')).toBe(65_536);
  });

  it('falls back to default when nothing matches', () => {
    expect(resolveEffectiveContextWindow(0, 'custom-local')).toBe(
      DEFAULT_CONTEXT_WINDOW,
    );
  });
});

describe('resolveHostContextWindowTokens', () => {
  it('honors MITII_CONTEXT_WINDOW over model inference', () => {
    expect(
      resolveHostContextWindowTokens({
        env: { MITII_CONTEXT_WINDOW: '64000' } as NodeJS.ProcessEnv,
        model: 'echo',
      }),
    ).toBe(64_000);
  });

  it('parses Nk env values', () => {
    expect(parseContextWindowTokens('64k')).toBe(65_536);
  });

  it('infers from model when env/config unset', () => {
    expect(
      resolveHostContextWindowTokens({
        env: {} as NodeJS.ProcessEnv,
        model: 'my-qwen-64k:latest',
        providerType: 'ollama',
      }),
    ).toBe(65_536);
  });
});
