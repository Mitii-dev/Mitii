import { describe, expect, it } from 'vitest';

import {
  DEFAULT_DESKTOP_SETTINGS,
  SETTINGS_CATALOG,
  catalogEntriesForPrefix,
  getSettingAtPath,
  mergeDesktopSettings,
  mitiiConfigFileToSettings,
  setSettingAtPath,
  settingsToMitiiConfigFile,
  settingsToEngineEnv,
} from '../src/shared/settings.js';
import { catalogNumberDescriptors } from '../src/renderer/settings/policyCatalog.js';

describe('desktop settings', () => {
  it('includes full VS Code mitii.* catalog', () => {
    expect(Object.keys(SETTINGS_CATALOG)).toHaveLength(212);
    expect(SETTINGS_CATALOG['mitii.provider.model']).toBeTruthy();
    expect(SETTINGS_CATALOG['mitii.tokenBudget.enabled']).toBeTruthy();
    expect(SETTINGS_CATALOG['mitii.loopPolicy.enabled']).toBeTruthy();
    expect(SETTINGS_CATALOG['mitii.autocomplete.enabled']).toBeTruthy();
    expect(SETTINGS_CATALOG['mitii.v8LoopPolicy.enabled']).toBeTruthy();
    expect(SETTINGS_CATALOG['mitii.workspace.indexConcurrency']).toBeTruthy();
    expect(
      SETTINGS_CATALOG['mitii.loopPolicy.maxReasoningCharsWithoutProgress'],
    ).toBeTruthy();
  });

  it('defaults include v8LoopPolicy and indexConcurrency from the catalog', () => {
    expect(DEFAULT_DESKTOP_SETTINGS.v8LoopPolicy).toMatchObject({
      enabled: false,
      preferredBatchSize: 12,
      toolLoopHardIdentical: 6,
      toolLoopSoftIdentical: 3,
    });
    expect(DEFAULT_DESKTOP_SETTINGS.workspace.indexConcurrency).toBe(0);
    expect(mergeDesktopSettings({}).v8LoopPolicy.maxContinueOverrides).toBe(4);
    expect(catalogEntriesForPrefix('v8LoopPolicy')).toHaveLength(9);
  });

  it('forces autocomplete.enabled off (Desktop FIM not shipped)', () => {
    const s = mergeDesktopSettings({
      autocomplete: { enabled: true },
    });
    expect(s.autocomplete.enabled).toBe(false);
  });

  it('merges nested defaults without clobbering siblings', () => {
    const s = mergeDesktopSettings({
      provider: { model: 'x' },
      ui: { showReasoning: false },
    });
    expect(s.provider.model).toBe('x');
    expect(s.provider.preset).toBe('ollama');
    expect(s.ui.showReasoning).toBe(false);
    expect(s.ui.contextToggles.diagnostics).toBe(true);
    expect(s.safety.approvalMode).toBe('guided');
    expect(s.safety.sandbox.backend).toBe('auto');
  });

  it('round-trips config file fields without secrets', () => {
    const settings = mergeDesktopSettings({
      provider: {
        type: 'openai-compatible',
        preset: 'ollama',
        model: 'qwen',
        baseUrl: 'http://127.0.0.1:11434/v1',
      },
      search: { searxngBaseUrl: 'http://127.0.0.1:8080' },
    });
    const file = settingsToMitiiConfigFile(settings);
    expect(file).not.toHaveProperty('apiKey');
    const back = mitiiConfigFileToSettings(file);
    expect(back.provider.preset).toBe('ollama');
    expect(back.provider.model).toBe('qwen');
    expect(back.search.searxngBaseUrl).toBe('http://127.0.0.1:8080');
  });

  it('maps engine env for provider, sandbox, and search key', () => {
    const env = settingsToEngineEnv(
      mergeDesktopSettings({
        provider: {
          type: 'anthropic',
          preset: 'anthropic',
          model: 'claude',
        },
        safety: {
          approvalMode: 'safe',
          sandbox: {
            enabled: true,
            network: 'deny',
            backend: 'auto',
          },
        },
      }),
      { apiKey: 'sk-test', searchApiKey: 'brave-test' },
    );
    expect(env.MITII_PROVIDER).toBe('anthropic');
    expect(env.MITII_MODEL).toBe('claude');
    expect(env.MITII_SANDBOX).toBe('1');
    expect(env.MITII_ANTHROPIC_API_KEY).toBe('sk-test');
    expect(env.MITII_SEARCH_API_KEY).toBe('brave-test');
    expect(env.MITII_FORCE_ECHO).toBe('0');
    expect(JSON.parse(env.MITII_DESKTOP_SETTINGS_JSON).provider.model).toBe(
      'claude',
    );
  });

  it('normalizes Ollama cloud size tags into MITII_MODEL', () => {
    const env = settingsToEngineEnv(
      mergeDesktopSettings({
        provider: {
          type: 'openai-compatible',
          preset: 'ollama',
          baseUrl: 'http://192.168.0.252:11434/v1',
          model: 'qwen3.5:397b',
        },
      }),
    );
    expect(env.MITII_MODEL).toBe('qwen3.5:cloud');
    const file = settingsToMitiiConfigFile(
      mergeDesktopSettings({
        provider: {
          type: 'openai-compatible',
          preset: 'ollama-cloud',
          baseUrl: 'https://ollama.com/v1',
          model: 'qwen3.5:397b',
        },
      }),
    );
    expect(file.model).toBe('qwen3.5:cloud');
  });

  it('passes context window and max output into engine env', () => {
    const env = settingsToEngineEnv(
      mergeDesktopSettings({
        provider: {
          type: 'openai-compatible',
          preset: 'ollama',
          model: 'my-qwen-64k:latest',
          contextWindow: 65_536,
          maximumOutputTokens: 8_192,
        },
      }),
    );
    expect(env.MITII_CONTEXT_WINDOW).toBe('65536');
    expect(env.MITII_MAXIMUM_OUTPUT_TOKENS).toBe('8192');
  });

  it('get/set setting paths for catalog keys', () => {
    const base = mergeDesktopSettings(DEFAULT_DESKTOP_SETTINGS);
    expect(getSettingAtPath(base, 'mitii.provider.model')).toBe('');
    const next = setSettingAtPath(base, 'mitii.tokenBudget.outputRatio', 0.25);
    expect(getSettingAtPath(next, 'tokenBudget.outputRatio')).toBe(0.25);
    expect(catalogEntriesForPrefix('autocomplete').length).toBeGreaterThan(5);
  });

  it.each(['tokenBudget', 'loopPolicy'])(
    '%s descriptors are a subset of the catalog',
    (prefix) => {
      const descriptors = catalogNumberDescriptors(prefix);
      expect(descriptors.length).toBeGreaterThan(0);
      for (const descriptor of descriptors) {
        const entry = SETTINGS_CATALOG[`mitii.${prefix}.${descriptor.key}`];
        expect(entry, descriptor.key).toBeTruthy();
        expect(descriptor.defaultValue).toBe(entry?.default);
      }
    },
  );

  it('folds engine.implementation into the catalog tree', () => {
    expect(DEFAULT_DESKTOP_SETTINGS.engine.implementation).toBe('v8');
    expect(getSettingAtPath(DEFAULT_DESKTOP_SETTINGS, 'agent.engineImplementation')).toBeUndefined();
    expect(
      settingsToEngineEnv(mergeDesktopSettings({ engine: { implementation: 'legacy' } }))
        .MITII_ENGINE_IMPLEMENTATION,
    ).toBe('legacy');
    expect(settingsToEngineEnv(mergeDesktopSettings({})).MITII_ENGINE_IMPLEMENTATION).toBe('v8');
  });

  it('migrates legacy agent.engineImplementation once on merge', () => {
    const migrated = mergeDesktopSettings({
      agent: { engineImplementation: 'legacy' },
    });
    expect(migrated.engine.implementation).toBe('legacy');
    expect(
      (migrated.agent as Record<string, unknown>).engineImplementation,
    ).toBeUndefined();
    const explicit = mergeDesktopSettings({
      agent: { engineImplementation: 'legacy' },
      engine: { implementation: 'v8' },
    });
    expect(explicit.engine.implementation).toBe('v8');
    expect(mergeDesktopSettings(migrated).engine.implementation).toBe('legacy');
  });
});
