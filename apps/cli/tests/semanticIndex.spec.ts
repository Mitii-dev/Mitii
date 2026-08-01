import { describe, expect, it } from 'vitest';

import { resolveCliSemanticIndexSettings } from '../src/semanticIndex.js';

describe('CLI semantic index settings', () => {
  it('does not enable vectors by default for local OpenAI-compatible chat providers', () => {
    const settings = resolveCliSemanticIndexSettings({
      env: {},
      config: {
        provider: 'openai-compatible',
        baseUrl: 'http://localhost:11434/v1',
      },
    });

    expect(settings.enabled).toBe(false);
    expect(settings.model).toBe('text-embedding-3-small');
  });

  it('enables vectors for local providers when an embedding model is explicitly configured', () => {
    const settings = resolveCliSemanticIndexSettings({
      env: { MITII_EMBEDDING_MODEL: 'nomic-embed-text' },
      config: {
        provider: 'openai-compatible',
        baseUrl: 'http://localhost:11434/v1',
      },
    });

    expect(settings.enabled).toBe(true);
    expect(settings.model).toBe('nomic-embed-text');
  });
});
