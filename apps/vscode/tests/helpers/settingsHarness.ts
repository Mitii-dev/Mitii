import { vi } from 'vitest';
import manifest from '../../package.json';
import { MitiiSidebarProvider } from '../../src/sidebar';
const registered: Record<string, unknown> = manifest.contributes.configuration.properties;

export function createProviderHarness() {
  const store = new Map<string, unknown>([
    ['provider.type', 'echo'],
    ['provider.preset', 'echo'],
    ['provider.baseUrl', ''],
    ['provider.model', 'echo'],
  ]);
  const updates: Array<{ key: string; value: unknown; target: unknown }> = [];
  const cfg = {
    inspect: (key: string) => ({ key, workspaceValue: store.get(key) }),
    get: (key: string, fallback?: unknown) =>
      store.has(key) ? store.get(key) : fallback,
    update: vi.fn(async (key: string, value: unknown, target: unknown) => {
      if (!registered[`mitii.${key}`]) throw new Error(`${key} is not a registered configuration`);
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
      inlineDiff: { setPending: vi.fn() } as never,
      reviewFindings: {} as never,
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
  return { provider, updates, store, cfg, target: vs.ConfigurationTarget.Workspace };
}
