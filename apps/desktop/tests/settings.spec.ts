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
import {
  DEFAULT_LOOP_POLICY_NUMBERS,
  DEFAULT_V8_LOOP_POLICY_NUMBERS,
  DEFAULT_WINDOW_BUDGET_NUMBERS,
} from '@mitii/ui-core';
import {
  LOOP_POLICY_PRESENTATION,
  TOKEN_BUDGET_PRESENTATION,
  V8_LOOP_POLICY_PRESENTATION,
} from '@mitii/settings';
import { catalogNumberDescriptors } from '../src/renderer/settings/policyCatalog.js';

describe('desktop settings', () => {
  it('includes full VS Code mitii.* catalog', () => {
    expect(Object.keys(SETTINGS_CATALOG)).toHaveLength(213);
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

  it('enables semantic index when config embeddingSource is bundled', () => {
    const settings = mitiiConfigFileToSettings({
      embeddingSource: 'bundled',
    });
    expect(settings.semanticIndex.source).toBe('bundled');
    expect(settings.semanticIndex.enabled).toBe(true);
  });

  it('aligns enabled=false + source=bundled defaults to enabled', () => {
    const settings = mergeDesktopSettings({
      semanticIndex: {
        enabled: false,
        source: 'bundled',
        backend: 'bundled',
        model: '',
        dimensions: 0,
        normalized: true,
      },
    });
    expect(settings.semanticIndex.enabled).toBe(true);
    expect(settings.semanticIndex.source).toBe('bundled');
  });

  it('keeps semantic off when source is disabled', () => {
    const settings = mergeDesktopSettings({
      semanticIndex: {
        enabled: false,
        source: 'disabled',
        backend: 'disabled',
        model: '',
        dimensions: 0,
        normalized: true,
      },
    });
    expect(settings.semanticIndex.enabled).toBe(false);
    expect(settings.semanticIndex.source).toBe('disabled');
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

  it('defaults OS sandbox on when unset so selective verify is fail-closed', () => {
    const env = settingsToEngineEnv(
      mergeDesktopSettings({
        safety: {
          approvalMode: 'never',
          sandbox: {
            enabled: null,
            network: null,
            backend: 'auto',
          },
        },
      }),
    );
    expect(env.MITII_SANDBOX).toBe('1');
    expect(env.MITII_SANDBOX_NETWORK).toBe('deny');
  });

  it('allows explicit sandbox disable', () => {
    const env = settingsToEngineEnv(
      mergeDesktopSettings({
        safety: {
          approvalMode: 'safe',
          sandbox: {
            enabled: false,
            network: 'deny',
            backend: 'auto',
          },
        },
      }),
    );
    expect(env.MITII_SANDBOX).toBe('0');
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

  it.each(['tokenBudget', 'loopPolicy', 'v8LoopPolicy'] as const)(
    '%s descriptors are a subset of the catalog',
    (prefix) => {
      const descriptors = catalogNumberDescriptors(prefix);
      expect(descriptors.length).toBeGreaterThan(0);
      for (const descriptor of descriptors) {
        const entry = SETTINGS_CATALOG[`mitii.${prefix}.${descriptor.key}`];
        expect(entry, descriptor.key).toBeTruthy();
        expect(descriptor.min, descriptor.key).toBe(entry?.minimum ?? 0);
        if (prefix === 'v8LoopPolicy') {
          expect(descriptor.defaultValue).toBe(entry?.default);
        }
      }
    },
  );

  it('tokenBudget defaults match the shared ship baseline used by VS Code', () => {
    for (const descriptor of catalogNumberDescriptors('tokenBudget')) {
      expect(descriptor.defaultValue, descriptor.key).toBe(
        DEFAULT_WINDOW_BUDGET_NUMBERS[descriptor.key],
      );
    }
    const byKey = new Map(
      catalogNumberDescriptors('tokenBudget').map((d) => [d.key, d]),
    );
    expect(byKey.get('outputRatio')?.defaultValue).toBe(0.2);
    expect(byKey.get('outputMinTokens')?.defaultValue).toBe(10_240);
  });

  it('tokenBudget keeps only the five Simple keys out of Advanced', () => {
    const budget = catalogNumberDescriptors('tokenBudget');
    expect(budget).toHaveLength(108);
    expect(budget.map((d) => d.key)).toEqual(Object.keys(TOKEN_BUDGET_PRESENTATION));
    for (const d of budget) {
      expect(d.group, d.key).toBe(TOKEN_BUDGET_PRESENTATION[d.key]!.group);
      expect(d.label, d.key).toBe(TOKEN_BUDGET_PRESENTATION[d.key]!.label);
      expect(d.label, d.key).not.toBe(d.key);
    }
    expect(new Set(budget.map((d) => d.group)).size).toBeGreaterThan(5);
    expect(budget.filter((d) => d.tier === 'simple').map((d) => d.key).sort()).toEqual(
      ['conversationShare', 'outputRatio', 'planShare', 'repositoryShare', 'skillsShare'],
    );
    const advanced = budget.filter(
      (d) => d.tier !== 'simple' && !d.hiddenFromDebug,
    );
    expect(advanced.length).toBe(108 - 5 - 3);
    expect(
      budget.filter((d) => d.hiddenFromDebug).map((d) => d.key).sort(),
    ).toEqual(['maxModelCallsMax', 'maxModelCallsMin', 'maxModelCallsPerUsable']);
  });

  it('loopPolicy / v8LoopPolicy descriptors split Simple and Advanced', () => {
    const loop = catalogNumberDescriptors('loopPolicy');
    expect(loop.map((d) => d.key)).toEqual(Object.keys(LOOP_POLICY_PRESENTATION));
    for (const d of loop) {
      expect(d.group, d.key).toBe(LOOP_POLICY_PRESENTATION[d.key]!.group);
      expect(d.label, d.key).not.toBe(d.key);
    }
    expect(
      loop.filter((d) => d.tier === 'simple').map((d) => d.key).sort(),
    ).toEqual(
      [
        'explorationRereadMinCalls',
        'explorationRereadRatio',
        'maxExplorationStallNudges',
        'maxReadOnlyMutationRetryAttempts',
        'maxReadOnlyToolTurnsAfterMutationNudge',
        'maxReadOnlyToolTurnsBeforeMutationNudge',
      ].sort(),
    );
    expect(loop.some((d) => d.tier === 'advanced')).toBe(true);
    const v8 = catalogNumberDescriptors('v8LoopPolicy');
    expect(v8).toHaveLength(8);
    expect(v8.map((d) => d.key)).toEqual(Object.keys(V8_LOOP_POLICY_PRESENTATION));
    for (const d of v8) {
      expect(d.group, d.key).toBe(V8_LOOP_POLICY_PRESENTATION[d.key]!.group);
      expect(d.group, d.key).toMatch(/^V8 /);
    }
    expect(v8.filter((d) => d.tier === 'simple')).toHaveLength(4);
    expect(v8.filter((d) => d.tier === 'advanced')).toHaveLength(4);
  });

  it('loopPolicy defaults use the SDK-aligned ui-core baseline, not catalog drift', () => {
    const loop = catalogNumberDescriptors('loopPolicy');
    for (const d of loop) {
      expect(d.defaultValue, d.key).toBe(DEFAULT_LOOP_POLICY_NUMBERS[d.key]);
    }
    const byKey = new Map(loop.map((d) => [d.key, d]));
    expect(byKey.get('explorationRereadMinCalls')?.defaultValue).toBe(6);
    expect(byKey.get('maxReadOnlyToolTurnsBeforeMutationNudge')?.defaultValue).toBe(4);
    expect(byKey.get('maxUnfulfilledExecuteRecoveries')?.defaultValue).toBe(2);
    expect(byKey.get('defaultPreferredBatchSize')?.defaultValue).toBe(12);
    expect(byKey.get('defaultMaxPatchesPerCall')?.defaultValue).toBe(24);
    // Catalog defaults are intentionally untouched.
    expect(SETTINGS_CATALOG['mitii.loopPolicy.explorationRereadMinCalls']?.default).toBe(8);
  });

  it('v8LoopPolicy defaults use the ui-core baseline (equal to the catalog)', () => {
    for (const d of catalogNumberDescriptors('v8LoopPolicy')) {
      expect(d.defaultValue, d.key).toBe(DEFAULT_V8_LOOP_POLICY_NUMBERS[d.key]);
      expect(d.defaultValue, d.key).toBe(
        SETTINGS_CATALOG[`mitii.v8LoopPolicy.${d.key}`]?.default,
      );
    }
  });

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
