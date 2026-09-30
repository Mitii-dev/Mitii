import {
  inferContextWindowFromModelId,
  inferMaximumOutputTokensFromModelId,
  resolveEffectiveContextWindow,
} from '../src/shared/contextWindow.js';

describe('contextWindow', () => {
  it('honors stored window when positive', () => {
    expect(resolveEffectiveContextWindow(65_536, 'any-model')).toBe(65_536);
  });

  it('infers 64k from model name tags', () => {
    expect(inferContextWindowFromModelId('my-qwen-64k:latest')).toBe(65_536);
    expect(resolveEffectiveContextWindow(0, 'my-qwen-64k:latest')).toBe(65_536);
  });

  it('falls back to 32k default for unknown local models', () => {
    expect(resolveEffectiveContextWindow(0, 'custom-local:latest')).toBe(32_768);
  });

  it('infers DeepSeek V4 completion hard max', () => {
    expect(inferMaximumOutputTokensFromModelId('deepseek-v4-pro:0813')).toBe(
      65_536,
    );
    expect(inferMaximumOutputTokensFromModelId('deepseek-chat')).toBe(8_192);
    expect(inferMaximumOutputTokensFromModelId('my-qwen-64k:latest')).toBeUndefined();
  });
});
