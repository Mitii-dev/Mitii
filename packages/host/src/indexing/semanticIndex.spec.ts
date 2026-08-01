import { describe, expect, it } from 'vitest';

import { shouldEnableSemanticIndex } from './semanticIndex.js';

describe('semantic index enablement', () => {
  it('disables semantic indexing for local OpenAI-compatible endpoints without an explicit embedding model', () => {
    expect(
      shouldEnableSemanticIndex({
        requested: true,
        providerType: 'openai-compatible',
        baseUrl: 'http://localhost:11434/v1',
        embeddingModelConfigured: false,
      }),
    ).toBe(false);
  });

  it('enables semantic indexing for local endpoints when an embedding model is explicitly configured', () => {
    expect(
      shouldEnableSemanticIndex({
        requested: true,
        providerType: 'openai-compatible',
        baseUrl: 'http://localhost:11434/v1',
        embeddingModelConfigured: true,
      }),
    ).toBe(true);
  });

  it('keeps cloud OpenAI-compatible endpoints enabled by default', () => {
    expect(
      shouldEnableSemanticIndex({
        requested: true,
        providerType: 'openai-compatible',
        baseUrl: 'https://api.openai.com/v1',
        embeddingModelConfigured: false,
      }),
    ).toBe(true);
  });
});
