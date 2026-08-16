import { describe, expect, it } from 'vitest';

import { resolveEmbeddingSource } from '../actions/ResolveEmbeddingSource.js';

describe('resolveEmbeddingSource', () => {
  it('defaults to bundled MiniLM when no source or backend is set', () => {
    const resolution = resolveEmbeddingSource({
      schemaVersion: 1,
      requestedEnabled: true,
      baseUrl: 'http://192.168.0.252:11434/v1',
      embeddingModelConfigured: false,
    });
    expect(resolution).toMatchObject({
      status: 'enabled',
      source: 'bundled',
      backend: 'bundled',
      model: 'all-MiniLM-L6-v2',
      dimensions: 384,
      reasonCode: 'default_bundled',
    });
  });

  it('keeps bundled MiniLM for legacy auto when no embedding model is configured', () => {
    const resolution = resolveEmbeddingSource({
      schemaVersion: 1,
      requestedEnabled: true,
      backend: 'auto',
      baseUrl: 'http://localhost:11434/v1',
      embeddingModelConfigured: false,
    });
    expect(resolution.status).toBe('enabled');
    if (resolution.status !== 'enabled') return;
    expect(resolution.source).toBe('bundled');
    expect(resolution.model).toBe('all-MiniLM-L6-v2');
  });

  it('uses Ollama when auto sees an explicit embedding model on an Ollama URL', () => {
    const resolution = resolveEmbeddingSource({
      schemaVersion: 1,
      requestedEnabled: true,
      backend: 'auto',
      baseUrl: 'http://localhost:11434/v1',
      embeddingModelConfigured: true,
    });
    expect(resolution).toMatchObject({
      status: 'enabled',
      source: 'ollama',
      model: 'nomic-embed-text',
      dimensions: 768,
    });
  });

  it('lets an explicit source override the chat provider URL', () => {
    const resolution = resolveEmbeddingSource({
      schemaVersion: 1,
      requestedEnabled: true,
      source: 'bundled',
      backend: 'ollama',
      baseUrl: 'https://api.anthropic.com',
      embeddingModelConfigured: false,
    });
    expect(resolution).toMatchObject({
      status: 'enabled',
      source: 'bundled',
      reasonCode: 'source_explicit',
    });
  });

  it('disables when requested or source is disabled', () => {
    expect(
      resolveEmbeddingSource({
        schemaVersion: 1,
        requestedEnabled: false,
        source: 'bundled',
        baseUrl: 'https://api.openai.com/v1',
        embeddingModelConfigured: false,
      }).status,
    ).toBe('disabled');
    expect(
      resolveEmbeddingSource({
        schemaVersion: 1,
        requestedEnabled: true,
        source: 'disabled',
        baseUrl: 'https://api.openai.com/v1',
        embeddingModelConfigured: false,
      }).source,
    ).toBe('disabled');
  });
});
