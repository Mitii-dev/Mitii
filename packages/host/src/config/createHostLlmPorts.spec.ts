import { describe, expect, it } from 'vitest';

import { createHostLlmPorts } from './createHostLlmPorts.js';
import { getProviderPreset } from './providerPresets.js';
import { inferHostProviderType, resolveProviderApiKey } from './resolveProviderApiKey.js';
import { testProviderConnection } from './testProviderConnection.js';

describe('createHostLlmPorts', () => {
  it('constructs echo ports for the echo preset', () => {
    const ports = createHostLlmPorts({ type: 'echo', model: 'echo' });
    expect(ports.type).toBe('echo');
    expect(ports.providerLabel).toBe('echo');
    expect(ports.runLlm.id).toBe('echo');
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
