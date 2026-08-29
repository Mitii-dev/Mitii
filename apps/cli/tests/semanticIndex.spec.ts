import { describe, expect, it } from 'vitest';

import { resolveCliSemanticIndexSettings } from '../src/semanticIndex.js';

describe('CLI semantic index settings', () => {
  it('uses bundled MiniLM by default for local OpenAI-compatible providers', () => {
    const settings = resolveCliSemanticIndexSettings({
      env: {},
      config: {
        provider: 'openai-compatible',
        baseUrl: 'http://localhost:11434/v1',
      },
    });

    expect(settings.enabled).toBe(true);
    expect(settings.backend).toBe('bundled');
    expect(settings.source).toBe('bundled');
    expect(settings.model).toBe('all-MiniLM-L6-v2');
    expect(settings.dimensions).toBe(384);
  });

  it('enables Ollama vectors when an embedding model is explicitly configured', () => {
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

  it('keeps bundled MiniLM for cloud chat providers unless an embedding source is set', () => {
    const settings = resolveCliSemanticIndexSettings({
      env: { OPENAI_API_KEY: 'test-key' },
      config: {
        provider: 'openai-compatible',
        baseUrl: 'https://api.openai.com/v1',
      },
    });

    expect(settings.enabled).toBe(true);
    expect(settings.backend).toBe('bundled');
    expect(settings.model).toBe('all-MiniLM-L6-v2');
  });

  it('uses OpenAI embeddings when the source is explicitly openai-compatible', () => {
    const settings = resolveCliSemanticIndexSettings({
      env: {
        OPENAI_API_KEY: 'test-key',
        MITII_EMBEDDING_SOURCE: 'openai-compatible',
      },
      config: {
        provider: 'openai-compatible',
        baseUrl: 'https://api.openai.com/v1',
      },
    });

    expect(settings.enabled).toBe(true);
    expect(settings.source).toBe('openai-compatible');
    expect(settings.model).toBe('text-embedding-3-small');
    expect(settings.dimensions).toBe(1536);
  });

  it('keeps LM Studio on bundled MiniLM unless an embedding model is configured', () => {
    const settings = resolveCliSemanticIndexSettings({
      env: { OPENAI_API_KEY: 'test-key' },
      config: {
        provider: 'openai-compatible',
        baseUrl: 'http://localhost:1234/v1',
      },
    });

    expect(settings.enabled).toBe(true);
    expect(settings.backend).toBe('bundled');
    expect(settings.model).toBe('all-MiniLM-L6-v2');
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
