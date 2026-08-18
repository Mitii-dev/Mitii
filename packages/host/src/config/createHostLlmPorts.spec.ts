import { describe, expect, it } from 'vitest';

import { createHostLlmPorts } from './createHostLlmPorts.js';
import { getProviderPreset } from './providerPresets.js';
import { inferHostProviderType, resolveProviderApiKey } from './resolveProviderApiKey.js';
import {
  listProviderModels,
  testProviderConnection,
} from './testProviderConnection.js';

describe('createHostLlmPorts', () => {
  it('constructs echo ports for the echo preset', () => {
    const ports = createHostLlmPorts({ type: 'echo', model: 'echo' });
    expect(ports.type).toBe('echo');
    expect(ports.providerLabel).toBe('echo');
    expect(ports.runLlm.id).toBe('echo');
  });

  it('enables prompt-cache usage mapping for openai-compatible runtimes', () => {
    const ports = createHostLlmPorts({
      type: 'openai-compatible',
      preset: 'ollama',
      model: 'qwen3.8:27b',
      baseUrl: 'http://localhost:11434/v1',
    });
    expect(ports.runLlm.capabilities.supportsPromptCaching).toBe(true);
    expect(ports.understandingLlm.capabilities.supportsPromptCaching).toBe(
      true,
    );
  });

  it('constructs openai-compatible ports from the deepseek preset', () => {
    const ports = createHostLlmPorts({
      type: 'openai-compatible',
      preset: 'deepseek',
      model: 'deepseek-chat',
      apiKey: 'sk-test',
    });
    expect(ports.type).toBe('openai-compatible');
    expect(ports.providerLabel).toBe('openai-compatible:deepseek-chat');
    expect(ports.runLlm.id).toBe('openai-compatible');
    expect(ports.runLlm.capabilities.supportsPromptCaching).toBe(true);
    expect(ports.understandingLlm.capabilities.supportsPromptCaching).toBe(true);
  });

  it('constructs native anthropic and gemini ports', () => {
    const anthropic = createHostLlmPorts({
      type: 'anthropic',
      model: 'claude-sonnet-4-5',
      apiKey: 'sk-ant-test',
    });
    expect(anthropic.type).toBe('anthropic');
    expect(anthropic.runLlm.id).toBe('anthropic');

    const gemini = createHostLlmPorts({
      type: 'gemini',
      model: 'gemini-2.5-flash',
      apiKey: 'gemini-test',
    });
    expect(gemini.type).toBe('gemini');
    expect(gemini.runLlm.id).toBe('gemini');
  });
});

describe('provider presets', () => {
  it('exposes anthropic, gemini, and deepseek presets', () => {
    expect(getProviderPreset('anthropic')?.type).toBe('anthropic');
    expect(getProviderPreset('gemini')?.type).toBe('gemini');
    expect(getProviderPreset('deepseek')?.type).toBe('openai-compatible');
  });
});

describe('resolveProviderApiKey', () => {
  it('prefers provider-specific env vars', () => {
    expect(
      resolveProviderApiKey({
        type: 'anthropic',
        env: {
          ANTHROPIC_API_KEY: 'sk-ant',
          MITII_API_KEY: 'generic',
        },
      }),
    ).toBe('sk-ant');
    expect(
      resolveProviderApiKey({
        type: 'gemini',
        env: { GOOGLE_API_KEY: 'g-key' },
      }),
    ).toBe('g-key');
  });

  it('infers provider type from env when MITII_PROVIDER is unset', () => {
    expect(inferHostProviderType({ ANTHROPIC_API_KEY: 'x' })).toBe('anthropic');
    expect(inferHostProviderType({ GEMINI_API_KEY: 'x' })).toBe('gemini');
    expect(inferHostProviderType({ OPENAI_API_KEY: 'x' })).toBe(
      'openai-compatible',
    );
  });
});

describe('testProviderConnection', () => {
  it('accepts echo without a network call', async () => {
    const result = await testProviderConnection({
      type: 'echo',
      model: 'echo',
    });
    expect(result.ok).toBe(true);
  });

  it('lists DeepSeek, OpenAI, Anthropic, Gemini, and Azure catalogs', async () => {
    const seen: string[] = [];
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      seen.push(url);
      const headers = new Headers(init?.headers);
      if (url === 'https://api.deepseek.com/v1/models') {
        expect(headers.get('Authorization')).toBe('Bearer ds-key');
        return new Response(
          JSON.stringify({
            data: [{ id: 'deepseek-chat' }, { id: 'deepseek-reasoner' }],
          }),
          { status: 200 },
        );
      }
      if (url === 'https://api.openai.com/v1/models') {
        expect(headers.get('Authorization')).toBe('Bearer oai-key');
        return new Response(
          JSON.stringify({ data: [{ id: 'gpt-4o-mini' }, { id: 'gpt-4.1' }] }),
          { status: 200 },
        );
      }
      if (url === 'https://api.anthropic.com/v1/models') {
        expect(headers.get('x-api-key')).toBe('ant-key');
        return new Response(
          JSON.stringify({
            data: [{ id: 'claude-sonnet-4-5' }, { id: 'claude-opus-4-1' }],
          }),
          { status: 200 },
        );
      }
      if (url === 'https://generativelanguage.googleapis.com/v1beta/models') {
        expect(headers.get('x-goog-api-key')).toBe('gem-key');
        return new Response(
          JSON.stringify({
            models: [
              { name: 'models/gemini-2.5-flash' },
              { name: 'models/gemini-2.5-pro' },
            ],
          }),
          { status: 200 },
        );
      }
      if (
        url ===
        'https://demo.openai.azure.com/openai/models?api-version=2024-06-01'
      ) {
        expect(headers.get('api-key')).toBe('az-key');
        return new Response(
          JSON.stringify({ data: [{ id: 'gpt-4o-mini' }] }),
          { status: 200 },
        );
      }
      return new Response('missing', { status: 404 });
    }) as typeof fetch;

    await expect(
      listProviderModels({
        type: 'openai-compatible',
        baseUrl: 'https://api.deepseek.com/v1',
        apiKey: 'ds-key',
        fetchImpl,
      }),
    ).resolves.toEqual(['deepseek-chat', 'deepseek-reasoner']);
    await expect(
      listProviderModels({
        type: 'openai-compatible',
        baseUrl: 'https://api.openai.com/v1',
        apiKey: 'oai-key',
        fetchImpl,
      }),
    ).resolves.toEqual(['gpt-4o-mini', 'gpt-4.1']);
    await expect(
      listProviderModels({
        type: 'anthropic',
        baseUrl: 'https://api.anthropic.com',
        apiKey: 'ant-key',
        fetchImpl,
      }),
    ).resolves.toEqual(['claude-sonnet-4-5', 'claude-opus-4-1']);
    await expect(
      listProviderModels({
        type: 'gemini',
        baseUrl: 'https://generativelanguage.googleapis.com',
        apiKey: 'gem-key',
        fetchImpl,
      }),
    ).resolves.toEqual(['gemini-2.5-flash', 'gemini-2.5-pro']);
    await expect(
      listProviderModels({
        type: 'openai-compatible',
        baseUrl:
          'https://demo.openai.azure.com/openai/deployments/gpt-4o-mini',
        apiKey: 'az-key',
        fetchImpl,
      }),
    ).resolves.toEqual(['gpt-4o-mini']);
    expect(seen.some((url) => url.endsWith('/api/tags'))).toBe(false);
  });

  it('lists OpenAI-compatible and Ollama tag catalogs', async () => {
    const fetchImpl = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/models')) {
        return new Response(JSON.stringify({ data: [{ id: 'qwen3-coder:30b' }] }), {
          status: 200,
        });
      }
      return new Response('missing', { status: 404 });
    }) as typeof fetch;
    await expect(
      listProviderModels({
        type: 'openai-compatible',
        baseUrl: 'http://localhost:11434/v1',
        fetchImpl,
      }),
    ).resolves.toEqual(['qwen3-coder:30b']);

    const tagsFetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/api/tags')) {
        return new Response(
          JSON.stringify({ models: [{ name: 'llama3.2:latest' }] }),
          { status: 200 },
        );
      }
      return new Response('missing', { status: 404 });
    }) as typeof fetch;
    await expect(
      listProviderModels({
        type: 'openai-compatible',
        baseUrl: 'http://localhost:11434/v1',
        fetchImpl: tagsFetch,
      }),
    ).resolves.toEqual(['llama3.2:latest']);
  });

  it('requires an API key for anthropic and gemini', async () => {
    expect(
      (await testProviderConnection({ type: 'anthropic', model: 'claude-sonnet-4-5' }))
        .ok,
    ).toBe(false);
    expect(
      (await testProviderConnection({ type: 'gemini', model: 'gemini-2.5-flash' })).ok,
    ).toBe(false);
  });
});
