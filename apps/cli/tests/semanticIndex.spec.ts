import { describe, expect, it } from 'vitest';

import { resolveCliSemanticIndexSettings } from '../src/semanticIndex.js';

describe('CLI semantic index settings', () => {
  it('uses the Ollama nomic embedding preset for local OpenAI-compatible providers', () => {
    const settings = resolveCliSemanticIndexSettings({
      env: {},
      config: {
        provider: 'openai-compatible',
        baseUrl: 'http://localhost:11434/v1',
      },
    });

    expect(settings.enabled).toBe(true);
    expect(settings.backend).toBe('ollama');
    expect(settings.model).toBe('nomic-embed-text');
    expect(settings.dimensions).toBe(768);
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
    expect(settings.backend).toBe('ollama');
    expect(settings.model).toBe('nomic-embed-text');
  });

  it('keeps OpenAI embedding defaults for cloud providers', () => {
    const settings = resolveCliSemanticIndexSettings({
      env: { OPENAI_API_KEY: 'test-key' },
      config: {
        provider: 'openai-compatible',
        baseUrl: 'https://api.openai.com/v1',
      },
    });

    expect(settings.enabled).toBe(true);
    expect(settings.backend).toBe('openai-compatible');
    expect(settings.model).toBe('text-embedding-3-small');
    expect(settings.dimensions).toBe(1536);
  });

  it('keeps LM Studio on the OpenAI-compatible embedding path', () => {
    const settings = resolveCliSemanticIndexSettings({
      env: { OPENAI_API_KEY: 'test-key' },
      config: {
        provider: 'openai-compatible',
        baseUrl: 'http://localhost:1234/v1',
      },
    });

    expect(settings.enabled).toBe(true);
    expect(settings.backend).toBe('openai-compatible');
    expect(settings.model).toBe('text-embedding-3-small');
  });

  it('honors disabled embedding backend', () => {
    const settings = resolveCliSemanticIndexSettings({
      env: { MITII_EMBEDDING_BACKEND: 'disabled' },
      config: {
        provider: 'openai-compatible',
        baseUrl: 'http://localhost:11434/v1',
      },
    });

    expect(settings.enabled).toBe(false);
    expect(settings.backend).toBe('disabled');
  });
});
