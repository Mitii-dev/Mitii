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
      ui: UI_PATCH,
      workspaceRootOverride: '/tmp/project',
      workspaceMaximumIndexFiles: 55_555,
      approvalMode: 'pilot',
      semanticIndex: { source: 'disabled' },
    });

    const byKey = new Map(updates.map((entry) => [entry.key, entry]));
    const expectedKeys = [
      'provider.type',
      'provider.preset',
      'provider.baseUrl',
      'provider.model',
      'provider.contextWindow',
      'provider.maximumOutputTokens',
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

    for (const key of expectedKeys) {
      expect(byKey.has(key), key).toBe(true);
      expect(byKey.get(key)?.target, key).toBe(target);
    }
    expect(byKey.get('provider.model')?.value).toBe('new-model');
    expect(byKey.get('provider.contextWindow')?.value).toBe(16_000);
    expect(byKey.get('provider.maximumOutputTokens')?.value).toBe(2048);
    expect(byKey.get('workspace.maximumIndexFiles')?.value).toBe(55_555);
    expect(byKey.get('semanticIndex.enabled')?.value).toBe(false);
  });
});
