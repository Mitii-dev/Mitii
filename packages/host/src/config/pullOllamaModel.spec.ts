import { describe, expect, it, vi } from 'vitest';

import {
  isOllamaModelInstalled,
  pullOllamaModel,
  resolveOllamaApiOrigin,
} from './pullOllamaModel.js';

describe('resolveOllamaApiOrigin', () => {
  it('strips /v1 from OpenAI-compatible roots', () => {
    expect(resolveOllamaApiOrigin('http://localhost:11434/v1')).toBe(
      'http://localhost:11434',
    );
  });

  it('defaults to local Ollama', () => {
    expect(resolveOllamaApiOrigin()).toBe('http://127.0.0.1:11434');
  });
});

describe('isOllamaModelInstalled', () => {
  it('matches bare and :latest tags', () => {
    expect(
      isOllamaModelInstalled(['nomic-embed-text:latest'], 'nomic-embed-text'),
    ).toBe(true);
    expect(
      isOllamaModelInstalled(['nomic-embed-text'], 'nomic-embed-text:latest'),
    ).toBe(true);
    expect(isOllamaModelInstalled(['mxbai-embed-large'], 'nomic-embed-text')).toBe(
      false,
    );
  });
});

describe('pullOllamaModel', () => {
  it('streams progress and succeeds', async () => {
    const lines = [
      JSON.stringify({ status: 'pulling manifest' }),
      JSON.stringify({
        status: 'downloading',
        digest: 'sha256:abc',
        total: 100,
        completed: 40,
      }),
      JSON.stringify({ status: 'success' }),
    ].join('\n');

    const fetchImpl = vi.fn(async () => {
      return new Response(lines, {
        status: 200,
        headers: { 'content-type': 'application/x-ndjson' },
      });
    });

    const progress: Array<{ status: string; percent?: number }> = [];
    const result = await pullOllamaModel({
      model: 'nomic-embed-text',
      baseUrl: 'http://127.0.0.1:11434/v1',
      fetchImpl: fetchImpl as unknown as typeof fetch,
      onProgress: (p) => progress.push({ status: p.status, percent: p.percent }),
    });

    expect(result).toEqual({ ok: true, model: 'nomic-embed-text' });
    expect(fetchImpl).toHaveBeenCalledWith(
      'http://127.0.0.1:11434/api/pull',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(progress.some((p) => p.percent === 40)).toBe(true);
    expect(progress.some((p) => p.status === 'success')).toBe(true);
  });

  it('returns a clear error when Ollama is unreachable', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('ECONNREFUSED');
    });

    const result = await pullOllamaModel({
      model: 'nomic-embed-text',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/Ollama|ECONNREFUSED/i);
    }
  });

  it('rejects an empty model name', async () => {
    const result = await pullOllamaModel({ model: '  ' });
    expect(result).toEqual({ ok: false, reason: 'Model name is required.' });
  });
});
