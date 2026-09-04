import { describe, expect, it, vi } from 'vitest';

import { MitiiSidebarProvider } from '../src/sidebar';
import type { UiSettingsSnapshot } from '../src/protocol';

function createProviderHarness() {
  const store = new Map<string, unknown>([
    ['provider.type', 'echo'],
    ['provider.preset', 'echo'],
    ['provider.baseUrl', ''],
    ['provider.model', 'echo'],
  ]);
  const updates: Array<{ key: string; value: unknown; target: unknown }> = [];
  const cfg = {
    get: (key: string, fallback?: unknown) =>
      store.has(key) ? store.get(key) : fallback,
    update: vi.fn(async (key: string, value: unknown, target: unknown) => {
      updates.push({ key, value, target });
      if (value === undefined) {
        store.delete(key);
      } else {
        store.set(key, value);
      }
    }),
  };
  const vs = {
    ConfigurationTarget: { Global: 'global', Workspace: 'workspace' },
    ExtensionMode: { Development: 1 },
    Uri: { file: (path: string) => ({ fsPath: path, scheme: 'file' }) },
    workspace: {
      workspaceFolders: [{ uri: { fsPath: '/tmp/workspace' } }],
      getConfiguration: () => cfg,
    },
    window: {
      showInformationMessage: vi.fn(),
    },
  };
  const provider = new MitiiSidebarProvider(
    vs as never,
    { fsPath: '/tmp/ext', scheme: 'file' } as never,
    async () => ({}) as never,
    () => undefined,
    () => 'workspace',
    { appendLine: vi.fn(), show: vi.fn() } as never,
    { get: vi.fn(async () => undefined) } as never,
    vi.fn(),
    async () => ({ fileCount: 0, truncated: false }),
    {
      extensionMode: 1 as never,
      workspaceState: { get: vi.fn(), update: vi.fn() } as never,
      inlineDiff: {} as never,
      onInlineDiffPending: vi.fn(),
    },
  );
  (provider as unknown as { sendBootstrap: () => Promise<void> }).sendBootstrap =
    async () => undefined;
  (
    provider as unknown as {
      refreshDiscoveredModels: () => Promise<void>;
    }
  ).refreshDiscoveredModels = async () => undefined;
  return { provider, updates, target: vs.ConfigurationTarget.Workspace };
}

const UI_PATCH: Partial<UiSettingsSnapshot> = {
  showReasoning: false,
  developerEnabled: true,
  intensityOverrides: true,
  debugLogging: true,
  modelIoLogging: true,
  reasoningPreviewMaxChars: 4000,
  depth: 'deep',
  effort: 'high',
  approvalMode: 'pilot',
  modeDefaults: {
    ask: {
      thoroughness: 'low',
      depth: 'quick',
      approvalMode: 'safe',
      model: 'ask-model',
    },
    plan: {
      thoroughness: 'high',
      depth: 'deep',
      approvalMode: 'guided',
      model: 'plan-model',
    },
    agent: {
      thoroughness: 'medium',
      depth: 'auto',
      approvalMode: 'pilot',
      model: 'agent-model',
    },
  },
  contextToggles: {
    repoMap: false,
    diagnostics: false,
    gitDiff: false,
    editor: false,
    openTabs: true,
    memory: false,
  },
  runBudget: {
    unlimited: false,
    maxModelCalls: 12,
    maxToolCalls: 24,
    maxLoopIterations: 40,
    maxWallTimeMinutes: 15,
  },
  tokenBudget: {
    enabled: true,
    policy: {
      outputRatio: 0.33,
      outputMinTokens: 2048,
    },
  } as never,
  loopPolicy: {
    enabled: true,
    thresholds: {
      explorationRereadMinCalls: 4,
      explorationRereadRatio: 2.5,
    },
  } as never,
};

describe('MitiiSidebarProvider settings persistence', () => {
  it('writes changed settings to the active workspace target and reflects stored values', async () => {
    const { provider, updates, target } = createProviderHarness();

    await (
      provider as unknown as {
        handleSettingsSet: (message: unknown) => Promise<void>;
      }
    ).handleSettingsSet({
      type: 'settings.set',
      provider: {
        type: 'echo',
        preset: 'echo',
        baseUrl: '',
        model: 'new-model',
        contextWindow: 16_000,
        maximumOutputTokens: 2048,
      },
      autocomplete: {
        enabled: true,
        provider: 'openai-compatible',
        baseUrl: ' http://localhost:1234/v1 ',
        model: ' local-fim ',
        endpointPath: '/fim/completions',
        authHeader: 'x-api-key',
        maxTokens: 1024,
        debounceMs: -1,
        timeoutMs: 100,
        prefixChars: 10,
        suffixChars: 999_999,
        temperature: 9,
      },
      ui: UI_PATCH,
      workspaceRootOverride: '/tmp/project',
      workspaceMaximumIndexFiles: 55_555,
      approvalMode: 'pilot',
      semanticIndex: { source: 'disabled' },
    });

    const byKey = new Map(updates.map((entry) => [entry.key, entry]));
    const expectedKeys = [
      'provider.model',
      'provider.contextWindow',
      'provider.maximumOutputTokens',
      'autocomplete.enabled',
      'autocomplete.provider',
      'autocomplete.baseUrl',
      'autocomplete.model',
      'autocomplete.endpointPath',
      'autocomplete.authHeader',
      'autocomplete.maxTokens',
      'autocomplete.debounceMs',
      'autocomplete.timeoutMs',
      'autocomplete.prefixChars',
      'autocomplete.suffixChars',
      'autocomplete.temperature',
      'ui.showReasoning',
      'developer.enabled',
      'developer.intensityOverrides',
      'debug',
      'developer.modelIo',
      'ui.reasoningPreviewMaxChars',
      'ui.depth',
      'ui.effort',
      'ui.modeDefaults.ask.thoroughness',
      'ui.modeDefaults.ask.depth',
      'ui.modeDefaults.ask.approvalMode',
      'ui.modeDefaults.ask.model',
      'ui.modeDefaults.plan.thoroughness',
      'ui.modeDefaults.plan.depth',
      'ui.modeDefaults.plan.approvalMode',
      'ui.modeDefaults.plan.model',
      'ui.modeDefaults.agent.thoroughness',
      'ui.modeDefaults.agent.depth',
      'ui.modeDefaults.agent.approvalMode',
      'ui.modeDefaults.agent.model',
      'runBudget.unlimited',
      'runBudget.maxModelCalls',
      'runBudget.maxToolCalls',
      'runBudget.maxLoopIterations',
      'runBudget.maxWallTimeMinutes',
      'tokenBudget.enabled',
      'tokenBudget.outputRatio',
      'tokenBudget.outputMinTokens',
      'loopPolicy.enabled',
      'loopPolicy.explorationRereadMinCalls',
      'loopPolicy.explorationRereadRatio',
      'ui.contextToggles.repoMap',
      'ui.contextToggles.diagnostics',
      'ui.contextToggles.gitDiff',
      'ui.contextToggles.editor',
      'ui.contextToggles.openTabs',
      'ui.contextToggles.memory',
      'safety.approvalMode',
      'workspace.rootPathOverride',
      'workspace.maximumIndexFiles',
      'semanticIndex.source',
      'semanticIndex.backend',
      'semanticIndex.enabled',
    ];
    // Unchanged provider.type / preset / baseUrl are skipped intentionally.
    expect(byKey.has('provider.type')).toBe(false);
    expect(byKey.has('provider.preset')).toBe(false);
    expect(byKey.has('provider.baseUrl')).toBe(false);

    for (const key of expectedKeys) {
      expect(byKey.has(key), key).toBe(true);
      expect(byKey.get(key)?.target, key).toBe(target);
    }
    expect(byKey.get('provider.model')?.value).toBe('new-model');
    expect(byKey.get('provider.contextWindow')?.value).toBe(16_000);
    expect(byKey.get('provider.maximumOutputTokens')?.value).toBe(2048);
    expect(byKey.get('autocomplete.baseUrl')?.value).toBe(
      'http://localhost:1234/v1',
    );
    expect(byKey.get('autocomplete.model')?.value).toBe('local-fim');
    expect(byKey.get('autocomplete.endpointPath')?.value).toBe(
      'fim/completions',
    );
    expect(byKey.get('autocomplete.maxTokens')?.value).toBe(512);
    expect(byKey.get('autocomplete.debounceMs')?.value).toBe(0);
    expect(byKey.get('autocomplete.timeoutMs')?.value).toBe(250);
    expect(byKey.get('autocomplete.prefixChars')?.value).toBe(128);
    expect(byKey.get('autocomplete.suffixChars')?.value).toBe(60_000);
    expect(byKey.get('autocomplete.temperature')?.value).toBe(2);
    expect(byKey.get('workspace.maximumIndexFiles')?.value).toBe(55_555);
    expect(byKey.get('semanticIndex.enabled')?.value).toBe(false);
  });

  it('does not bootstrap after test connection (preserves unsaved drafts)', async () => {
    const { provider } = createProviderHarness();
    const sendBootstrap = vi.fn(async () => undefined);
    const posts: unknown[] = [];
    (provider as unknown as { sendBootstrap: () => Promise<void> }).sendBootstrap =
      sendBootstrap;
    (provider as unknown as { post: (message: unknown) => void }).post = (
      message,
    ) => {
      posts.push(message);
    };
    (provider as unknown as { secrets: { get: () => Promise<undefined> } }).secrets =
      { get: async () => undefined };

    const fetchImpl = vi.fn(async (url: string) => {
      if (String(url).includes('/models') || String(url).includes('/api/tags')) {
        return {
          ok: true,
          json: async () => ({
            data: [{ id: 'gemma4:31b' }, { id: 'qwen3.8:27b' }],
            models: [{ name: 'gemma4:31b' }, { name: 'qwen3.8:27b' }],
          }),
        };
      }
      return {
        ok: true,
        json: async () => ({
          choices: [{ message: { content: 'ok' } }],
        }),
      };
    });
    vi.stubGlobal('fetch', fetchImpl);

    try {
      await (
        provider as unknown as {
          handleTestConnection: (message: unknown) => Promise<void>;
        }
      ).handleTestConnection({
        type: 'provider.testConnection',
        provider: {
          type: 'openai-compatible',
          baseUrl: 'https://ollama.com/v1',
          model: 'gemma4:31b',
        },
      });

      expect(sendBootstrap).not.toHaveBeenCalled();
      expect(
        posts.some((p) => (p as { type: string }).type === 'provider.models'),
      ).toBe(true);
      const finalResult = posts.find(
        (p) =>
          (p as { type: string; testing?: boolean }).type ===
            'provider.connectionResult' &&
          (p as { testing?: boolean }).testing === false,
      ) as { ok: boolean; models?: string[] } | undefined;
      expect(finalResult?.ok).toBe(true);
      expect(finalResult?.models?.length).toBeGreaterThan(0);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('skips model rediscovery on model-only settings patches', async () => {
    const { provider } = createProviderHarness();
    const refreshDiscoveredModels = vi.fn(async () => undefined);
    (
      provider as unknown as {
        refreshDiscoveredModels: (options: unknown) => Promise<void>;
      }
    ).refreshDiscoveredModels = refreshDiscoveredModels;
    (
      provider as unknown as { discoveredModels: string[] }
    ).discoveredModels = ['gemma4:31b'];

    await (
      provider as unknown as {
        handleSettingsSet: (message: unknown) => Promise<void>;
      }
    ).handleSettingsSet({
      type: 'settings.set',
      provider: { model: 'gemma4:31b' },
    });

    expect(refreshDiscoveredModels).not.toHaveBeenCalled();
    expect(
      (provider as unknown as { discoveredModels: string[] }).discoveredModels,
    ).toEqual(['gemma4:31b']);
  });

  it('bootstraps before model refresh and skips rediscovery when type/url are unchanged', async () => {
    const { provider, updates } = createProviderHarness();
    const refreshDiscoveredModels = vi.fn(async () => undefined);
    const posts: unknown[] = [];
    (
      provider as unknown as {
        refreshDiscoveredModels: (options: unknown) => Promise<void>;
      }
    ).refreshDiscoveredModels = refreshDiscoveredModels;
    const sendBootstrap = vi.fn(async () => undefined);
    (
      provider as unknown as { sendBootstrap: () => Promise<void> }
    ).sendBootstrap = sendBootstrap;
    (provider as unknown as { post: (message: unknown) => void }).post = (
      message,
    ) => {
      posts.push(message);
    };

    await (
      provider as unknown as {
        handleSettingsSet: (message: unknown) => Promise<void>;
      }
    ).handleSettingsSet({
      type: 'settings.set',
      provider: {
        type: 'echo',
        preset: 'echo',
        baseUrl: '',
        model: 'echo',
        contextWindow: 100_000,
        maximumOutputTokens: 5_000,
      },
    });

    expect(posts.some((p) => (p as { type: string }).type === 'settings.saved')).toBe(
      true,
    );
    expect(sendBootstrap).toHaveBeenCalled();
    expect(refreshDiscoveredModels).not.toHaveBeenCalled();
    expect(
      updates.find((entry) => entry.key === 'provider.contextWindow')?.value,
    ).toBe(100_000);
    expect(
      updates.find((entry) => entry.key === 'provider.maximumOutputTokens')
        ?.value,
    ).toBe(0);
  });
});
