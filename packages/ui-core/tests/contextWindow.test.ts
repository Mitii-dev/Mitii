import { describe, expect, it } from 'vitest';

import {
  DEFAULT_CONTEXT_WINDOW,
  clampMaximumOutputTokensToContext,
  inferContextWindowFromModelId,
  inferMaximumOutputTokensFromModelId,
  parseContextWindowTokens,
  resolveEffectiveContextWindow,
} from '../src/contextWindow.js';

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

  it.each([
    'deepseek-chat',
    'deepseek-reasoner',
    'deepseek-v4-pro:0813',
    'deepseek/deepseek-chat-v3-0324',
    'deepseek-r1:32b',
  ])('resolves DeepSeek model %s to the 128k preset when auto', (model) => {
    expect(resolveEffectiveContextWindow(0, model, 'openai-compatible')).toBe(
      128_000,
    );
  });

  it('falls back to default when nothing matches', () => {
    expect(resolveEffectiveContextWindow(0, 'custom-local')).toBe(
      DEFAULT_CONTEXT_WINDOW,
    );
  });
});

describe('inferMaximumOutputTokensFromModelId', () => {
  it('resolves DeepSeek family completion caps', () => {
    expect(inferMaximumOutputTokensFromModelId('deepseek-v4-pro:0813')).toBe(
      65_536,
    );
    expect(inferMaximumOutputTokensFromModelId('deepseek-chat')).toBe(8_192);
    expect(
      inferMaximumOutputTokensFromModelId('my-qwen-64k:latest'),
    ).toBeUndefined();
  });
});

describe('clampMaximumOutputTokensToContext', () => {
  it('never exceeds the context window and treats non-positive as auto', () => {
    expect(clampMaximumOutputTokensToContext(65_536, 65_000)).toBe(65_000);
    expect(clampMaximumOutputTokensToContext(0, 65_000)).toBe(0);
  });
});

describe('parseContextWindowTokens', () => {
  it('parses Nk values', () => {
    expect(parseContextWindowTokens('64k')).toBe(65_536);
  });
});
