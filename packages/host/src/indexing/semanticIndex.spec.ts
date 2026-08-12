import { describe, expect, it } from 'vitest';

import {
  alignSemanticSettingsWithPersistedProfile,
  createHostEmbeddingProvider,
  probeEmbeddingProvider,
  resolveDefaultEmbeddingPreset,
  shouldEnableSemanticIndex,
} from './semanticIndex.js';

describe('semantic index enablement', () => {
  it('enables semantic indexing for local OpenAI-compatible endpoints through the Ollama preset', () => {
    expect(
      shouldEnableSemanticIndex({
        requested: true,
        providerType: 'openai-compatible',
        baseUrl: 'http://localhost:11434/v1',
        embeddingModelConfigured: false,
        backend: 'ollama',
      }),
    ).toBe(true);
  });

  it('enables semantic indexing for local endpoints when an embedding model is explicitly configured', () => {
    expect(
      shouldEnableSemanticIndex({
        requested: true,
        providerType: 'openai-compatible',
        baseUrl: 'http://localhost:11434/v1',
        embeddingModelConfigured: true,
        backend: 'ollama',
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
        backend: 'openai-compatible',
      }),
    ).toBe(true);
  });

  it('chooses nomic-embed-text for Ollama auto embedding presets', () => {
    const preset = resolveDefaultEmbeddingPreset({
      baseUrl: 'http://localhost:11434/v1',
      backend: 'auto',
    });

    expect(preset.backend).toBe('ollama');
    expect(preset.model).toBe('nomic-embed-text');
    expect(preset.dimensions).toBe(768);
  });

  it('does not treat other local OpenAI-compatible hosts as Ollama', () => {
    const preset = resolveDefaultEmbeddingPreset({
      baseUrl: 'http://localhost:1234/v1',
      backend: 'auto',
    });

    expect(preset.backend).toBe('openai-compatible');
    expect(preset.model).toBe('text-embedding-3-small');
  });

  it('isolates embedding profiles by backend, model, dimensions, and normalization', () => {
    const left = createHostEmbeddingProvider({
      enabled: true,
      backend: 'ollama',
      baseUrl: 'http://localhost:11434/v1',
      model: 'nomic-embed-text',
      dimensions: 768,
      normalized: true,
    });
    const right = createHostEmbeddingProvider({
      enabled: true,
      backend: 'ollama',
      baseUrl: 'http://localhost:11434/v1',
      model: 'nomic-embed-text',
      dimensions: 1024,
      normalized: true,
    });
    const cloud = createHostEmbeddingProvider({
      enabled: true,
      backend: 'openai-compatible',
      baseUrl: 'https://api.openai.com/v1',
      model: 'text-embedding-3-small',
      dimensions: 1536,
      normalized: true,
    });

    expect(left.profile.id).toBe('ollama:nomic-embed-text:768:normalized');
    expect(right.profile.id).not.toBe(left.profile.id);
    expect(cloud.profile.id).toBe(
      'openai-compatible:text-embedding-3-small:1536:normalized',
    );
  });

  it('omits dimensions for Ollama embedding requests', async () => {
    let body: unknown;
    const provider = createHostEmbeddingProvider({
      enabled: true,
      backend: 'ollama',
      baseUrl: 'http://localhost:11434/v1',
      model: 'nomic-embed-text',
      dimensions: 3,
      normalized: true,
      fetchImpl: async (_url, init) => {
        body = JSON.parse(String(init?.body));
        return new Response(
          JSON.stringify({
            data: [{ index: 0, embedding: [1, 2, 3] }],
          }),
          { status: 200 },
        );
      },
    });

    await provider.embed(['hello']);

    expect(body).toEqual({
      model: 'nomic-embed-text',
      input: ['hello'],
    });
  });

  it('keeps dimensions for OpenAI-compatible embedding requests', async () => {
    let body: unknown;
    const provider = createHostEmbeddingProvider({
      enabled: true,
      backend: 'openai-compatible',
      baseUrl: 'https://api.openai.com/v1',
      model: 'text-embedding-3-small',
      dimensions: 3,
      normalized: true,
      fetchImpl: async (_url, init) => {
        body = JSON.parse(String(init?.body));
        return new Response(
          JSON.stringify({
            data: [{ index: 0, embedding: [1, 2, 3] }],
          }),
          { status: 200 },
        );
      },
    });

    await provider.embed(['hello']);

    expect(body).toEqual({
      model: 'text-embedding-3-small',
      input: ['hello'],
      dimensions: 3,
    });
  });

  it('discovers Ollama vector dimensions during probe', async () => {
    const result = await probeEmbeddingProvider({
      enabled: true,
      backend: 'ollama',
      baseUrl: 'http://localhost:11434/v1',
      model: 'nomic-embed-text',
      dimensions: 768,
      normalized: true,
      fetchImpl: async () =>
        new Response(
          JSON.stringify({
            data: [{ index: 0, embedding: [1, 2, 3, 4] }],
          }),
          { status: 200 },
        ),
    });

    expect(result).toEqual({
      ok: true,
      dimensions: 4,
    });
  });

  it('normalizes Ollama base URLs that omit /v1', async () => {
    let requestedUrl = '';
    const provider = createHostEmbeddingProvider({
      enabled: true,
      backend: 'ollama',
      baseUrl: 'http://127.0.0.1:11434',
      model: 'nomic-embed-text',
      dimensions: 3,
      normalized: true,
      fetchImpl: async (url) => {
        requestedUrl = String(url);
        return new Response(
          JSON.stringify({
            embeddings: [[1, 2, 3]],
          }),
          { status: 200 },
        );
      },
    });

    await provider.embed(['hello']);

    expect(requestedUrl).toBe('http://127.0.0.1:11434/v1/embeddings');
  });

  it('accepts Ollama native embedding payloads', async () => {
    const provider = createHostEmbeddingProvider({
      enabled: true,
      backend: 'ollama',
      baseUrl: 'http://localhost:11434/v1',
      model: 'nomic-embed-text',
      dimensions: 2,
      normalized: true,
      fetchImpl: async () =>
        new Response(
          JSON.stringify({
            embedding: [1, 2],
          }),
          { status: 200 },
        ),
    });

    await expect(provider.embed(['hello'])).resolves.toEqual([[1, 2]]);
  });

  it('aligns retrieval dimensions to the persisted embedding profile', () => {
    const aligned = alignSemanticSettingsWithPersistedProfile(
      {
        enabled: true,
        backend: 'ollama',
        baseUrl: 'http://localhost:11434/v1',
        model: 'nomic-embed-text',
        dimensions: 1536,
        normalized: true,
      },
      {
        id: 'ollama:nomic-embed-text:768:normalized',
        providerId: 'ollama',
        modelId: 'nomic-embed-text',
        dimensions: 768,
        normalized: true,
      },
    );

    expect(aligned?.dimensions).toBe(768);
    expect(
      alignSemanticSettingsWithPersistedProfile(
        {
          enabled: true,
          backend: 'ollama',
          baseUrl: 'http://localhost:11434/v1',
          model: 'nomic-embed-text',
          dimensions: 768,
          normalized: true,
        },
        {
          id: 'openai-compatible:text-embedding-3-small:1536:normalized',
          providerId: 'openai-compatible',
          modelId: 'text-embedding-3-small',
          dimensions: 1536,
          normalized: true,
        },
      ),
    ).toBeUndefined();
  });

  it('explains Ollama probe failures with a pull hint', async () => {
    const result = await probeEmbeddingProvider({
      enabled: true,
      backend: 'ollama',
      baseUrl: 'http://localhost:11434/v1',
      model: 'nomic-embed-text',
      dimensions: 768,
      normalized: true,
      fetchImpl: async () =>
        new Response('model not found', { status: 404, statusText: 'Not Found' }),
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain('ollama pull nomic-embed-text');
  });
});
