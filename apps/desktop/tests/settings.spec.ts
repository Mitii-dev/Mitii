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

describe('desktop settings', () => {
  it('includes full VS Code mitii.* catalog', () => {
    expect(Object.keys(SETTINGS_CATALOG).length).toBeGreaterThan(100);
    expect(SETTINGS_CATALOG['mitii.provider.model']).toBeTruthy();
    expect(SETTINGS_CATALOG['mitii.tokenBudget.enabled']).toBeTruthy();
    expect(SETTINGS_CATALOG['mitii.loopPolicy.enabled']).toBeTruthy();
    expect(SETTINGS_CATALOG['mitii.autocomplete.enabled']).toBeTruthy();
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

  it('get/set setting paths for catalog keys', () => {
    const base = mergeDesktopSettings(DEFAULT_DESKTOP_SETTINGS);
    expect(getSettingAtPath(base, 'mitii.provider.model')).toBe('');
    const next = setSettingAtPath(base, 'mitii.tokenBudget.outputRatio', 0.25);
    expect(getSettingAtPath(next, 'tokenBudget.outputRatio')).toBe(0.25);
    expect(catalogEntriesForPrefix('autocomplete').length).toBeGreaterThan(5);
  });
});
