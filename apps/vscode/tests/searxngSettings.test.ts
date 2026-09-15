import { describe, expect, it, vi } from 'vitest';

import { MitiiSidebarProvider } from '../src/sidebar';
import type { SearchSettingsSnapshot } from '../src/protocol';

function createProviderHarness(options?: {
  initialSearxngBaseUrl?: string;
  searchApiKey?: string;
}) {
  const store = new Map<string, unknown>([
    ['provider.type', 'echo'],
    ['provider.preset', 'echo'],
    ['provider.baseUrl', ''],
    ['provider.model', 'echo'],
  ]);
  if (options?.initialSearxngBaseUrl !== undefined) {
    store.set('search.searxngBaseUrl', options.initialSearxngBaseUrl);
  }
  const updates: Array<{ key: string; value: unknown; target: unknown }> = [];
  const invalidateClient = vi.fn();
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
  const secrets = {
    get: vi.fn(async (key: string) =>
      key === 'mitii.search.apiKey' ? options?.searchApiKey : undefined,
    ),
  };
  const provider = new MitiiSidebarProvider(
    vs as never,
    { fsPath: '/tmp/ext', scheme: 'file' } as never,
    async () => ({}) as never,
    () => undefined,
    () => 'workspace',
    { appendLine: vi.fn(), show: vi.fn() } as never,
    secrets as never,
    invalidateClient,
    async () => ({ fileCount: 0, truncated: false }),
    {
      extensionMode: 1 as never,
      workspaceState: { get: vi.fn(), update: vi.fn() } as never,
      inlineDiff: {} as never,
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
  return {
    provider,
    updates,
    invalidateClient,
    target: vs.ConfigurationTarget.Workspace,
  };
}

describe('VS Code SearXNG URL settings', () => {
  it('persists mitii.search.searxngBaseUrl from settings.set and trims whitespace', async () => {
    const { provider, updates, invalidateClient, target } =
      createProviderHarness();

    await (
      provider as unknown as {
        handleSettingsSet: (message: unknown) => Promise<void>;
      }
    ).handleSettingsSet({
      type: 'settings.set',
      search: {
        searxngBaseUrl: '  http://192.168.0.91:8888/  ',
      },
    });

    const write = updates.find((entry) => entry.key === 'search.searxngBaseUrl');
    expect(write).toBeDefined();
    expect(write?.value).toBe('http://192.168.0.91:8888/');
    expect(write?.target).toBe(target);
    expect(invalidateClient).toHaveBeenCalled();
  });

  it('reads saved SearXNG URL back into the settings snapshot', async () => {
    const { provider } = createProviderHarness({
      initialSearxngBaseUrl: ' http://192.168.0.91:8888 ',
    });

    const search = await (
      provider as unknown as {
        readSearch: () => Promise<SearchSettingsSnapshot>;
      }
    ).readSearch();

    expect(search.searxngBaseUrl).toBe('http://192.168.0.91:8888');
    expect(search.hasApiKey).toBe(false);
  });

  it('reports Brave search key status separately from SearXNG URL', async () => {
    const { provider } = createProviderHarness({
      initialSearxngBaseUrl: 'http://127.0.0.1:8080',
      searchApiKey: 'brave-test-key',
    });

    const search = await (
      provider as unknown as {
        readSearch: () => Promise<SearchSettingsSnapshot>;
      }
    ).readSearch();

    expect(search.searxngBaseUrl).toBe('http://127.0.0.1:8080');
    expect(search.hasApiKey).toBe(true);
  });

  it('skips rewrite when SearXNG URL is unchanged', async () => {
    const { provider, updates, invalidateClient } = createProviderHarness({
      initialSearxngBaseUrl: 'http://192.168.0.91:8888',
    });

    await (
      provider as unknown as {
        handleSettingsSet: (message: unknown) => Promise<void>;
      }
    ).handleSettingsSet({
      type: 'settings.set',
      search: {
        searxngBaseUrl: 'http://192.168.0.91:8888',
      },
    });

    expect(
      updates.some((entry) => entry.key === 'search.searxngBaseUrl'),
    ).toBe(false);
    // writeSearchSettings still invalidates so ports rebuild after Save.
    expect(invalidateClient).toHaveBeenCalled();
  });
});
