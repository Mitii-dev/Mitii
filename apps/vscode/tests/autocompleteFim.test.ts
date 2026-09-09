import { describe, expect, it, vi } from 'vitest';

import {
  buildFimHeaders,
  buildFimRequestBody,
  buildFimUrl,
  sanitizeFimCompletion,
  sliceFimContext,
} from '../src/autocomplete/fim';
import { OpenAiCompatibleFimClient } from '../src/autocomplete/openAiCompatibleFimClient';
import {
  readAutocompleteSettings,
  resolveAutocompleteRuntimeSettings,
} from '../src/autocomplete/settings';

function config(values: Record<string, unknown>) {
  return {
    get: (key: string, fallback?: unknown) =>
      key in values ? values[key] : fallback,
  };
}

describe('FIM autocomplete helpers', () => {
  it('slices bounded prefix and suffix around the cursor', () => {
    const context = sliceFimContext({
      text: '0123456789',
      offset: 6,
      prefixChars: 4,
      suffixChars: 3,
    });

    expect(context).toEqual({ prefix: '2345', suffix: '678' });
  });

  it('builds generic OpenAI-compatible FIM requests', () => {
    expect(
      buildFimUrl({
        baseUrl: 'https://example.test/v1/',
        endpointPath: '/fim/completions',
      }),
    ).toBe('https://example.test/v1/fim/completions');
    expect(
      buildFimHeaders({ authHeader: 'x-api-key', apiKey: 'secret' }),
    ).toEqual({
      'Content-Type': 'application/json',
      'x-api-key': 'secret',
    });
    expect(
      buildFimRequestBody({
        model: 'fim-model',
        prefix: 'const value = ',
        suffix: ';',
        maxTokens: 32,
        temperature: 0.1,
      }),
    ).toMatchObject({
      model: 'fim-model',
      prompt: 'const value = ',
      suffix: ';',
      max_tokens: 32,
      temperature: 0.1,
      stream: false,
    });
  });

  it('strips markdown fences and suffix overlap', () => {
    expect(
      sanitizeFimCompletion({
        completion: '```ts\nanswer();\nnext();',
        suffix: '\nnext();\n',
      }),
    ).toBe('answer();');
  });
});

describe('autocomplete settings', () => {
  it('normalizes bounded settings and falls back to provider runtime values', () => {
    const autocomplete = readAutocompleteSettings(
      config({
        'autocomplete.enabled': true,
        'autocomplete.baseUrl': '',
        'autocomplete.model': '',
        'autocomplete.endpointPath': '/completions',
        'autocomplete.authHeader': 'api-key',
        'autocomplete.maxTokens': 9000,
        'autocomplete.debounceMs': -100,
        'autocomplete.timeoutMs': 100,
        'autocomplete.prefixChars': 16,
        'autocomplete.suffixChars': 100_000,
        'autocomplete.temperature': 5,
      }) as never,
    );

    expect(autocomplete).toMatchObject({
      enabled: true,
      endpointPath: 'completions',
      authHeader: 'api-key',
      maxTokens: 512,
      debounceMs: 0,
      timeoutMs: 250,
      prefixChars: 128,
      suffixChars: 60_000,
      temperature: 2,
    });

    expect(
      resolveAutocompleteRuntimeSettings({
        autocomplete,
        providerBaseUrl: 'https://provider.test/v1',
        providerModel: 'provider-model',
      }),
    ).toMatchObject({
      baseUrl: 'https://provider.test/v1',
      model: 'provider-model',
    });
  });
});

describe('OpenAiCompatibleFimClient', () => {
  it('posts to the configured endpoint and extracts text choices', async () => {
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      expect(init?.method).toBe('POST');
      expect(JSON.parse(String(init?.body))).toMatchObject({
        model: 'fim-model',
        prompt: 'const a = ',
        suffix: ';',
      });
      return new Response(
        JSON.stringify({ choices: [{ text: '1;' }] }),
        { status: 200 },
      );
    }) as unknown as typeof fetch;

    const client = new OpenAiCompatibleFimClient({
      baseUrl: 'https://example.test/v1',
      endpointPath: 'completions',
      authHeader: 'authorization',
      apiKey: 'secret',
      timeoutMs: 1000,
      fetchImpl,
    });

    await expect(
      client.complete({
        model: 'fim-model',
        prefix: 'const a = ',
        suffix: ';',
        maxTokens: 16,
        temperature: 0,
      }),
    ).resolves.toEqual({ text: '1' });
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://example.test/v1/completions',
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer secret',
        }),
      }),
    );
  });
});
