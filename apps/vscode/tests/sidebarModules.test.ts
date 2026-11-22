import { describe, expect, it } from 'vitest';
import {
  capabilityRevision,
  indexStatusFromDescriptor,
  needsFullIndexRefresh,
  type RepositoryDescriptorSnapshot,
} from '../src/sidebar/indexDescriptor';
import { configValuesEqual } from '../src/sidebar/configValues';
import { planFromAnswer, savedPlanMarkdownRelative } from '../src/sidebar/runPrompt';
import { TokenUsageTracker, emptyTokenUsage } from '../src/sidebar/tokenUsage';
import { createProviderHarness } from './helpers/settingsHarness';

const descriptor: RepositoryDescriptorSnapshot = {
  workspaceId: 'ws',
  stateToken: '0123456789abcdef0123',
  readiness: 'ready',
  scanCompleteness: 'complete',
  cleanupAllowed: true,
  generatedAt: '2026-01-01T00:00:00.000Z',
  roots: [
    {
      rootId: 'root-a',
      projectCatalogRevision: 'cat-1',
      codeIndexRevision: 'code-1',
      vectorProfile: 'bundled',
      vectorIndexRevision: 'vec-1',
      capabilities: [
        { capability: 'codeIndex', status: 'available' },
        { capability: 'vectorIndex', status: 'degraded', reasonCode: 'stale' },
      ],
    },
  ],
};

describe('sidebar/indexDescriptor', () => {
  it('maps capability names to the owning revision field', () => {
    const root = descriptor.roots[0]!;
    expect(capabilityRevision(root, 'codeIndex')).toBe('code-1');
    expect(capabilityRevision(root, 'catalog')).toBe('cat-1');
    expect(capabilityRevision(root, 'unknown')).toBeUndefined();
  });

  it('projects a descriptor into index status fields', () => {
    const status = indexStatusFromDescriptor(descriptor);
    expect(status.rootCount).toBe(1);
    expect(status.stateTokenPreview).toBe('0123456789abcdef');
    expect(status.capabilities).toEqual([
      expect.objectContaining({ capability: 'codeIndex', revision: 'code-1' }),
      expect.objectContaining({
        capability: 'vectorIndex',
        profile: 'bundled',
        reasonCode: 'stale',
      }),
    ]);
  });

  it('requests a full refresh for host snapshots or missing core capabilities', () => {
    expect(
      needsFullIndexRefresh({ fileCount: 1, truncated: false, indexMode: 'host_snapshot' }),
    ).toBe(true);
    expect(needsFullIndexRefresh({ fileCount: 1, truncated: false })).toBe(false);
    expect(
      needsFullIndexRefresh({
        fileCount: 1,
        truncated: false,
        capabilities: [
          { rootId: 'r', capability: 'codeIndex', status: 'available' },
        ],
      }),
    ).toBe(true);
  });
});

describe('sidebar/configValues', () => {
  it('treats equal primitives as equal and mismatched types as different', () => {
    expect(configValuesEqual(1, 1)).toBe(true);
    expect(configValuesEqual('a', 'a')).toBe(true);
    expect(configValuesEqual(true, true)).toBe(true);
    expect(configValuesEqual(1, '1')).toBe(false);
    expect(configValuesEqual({ a: 1 }, { a: 1 })).toBe(false);
  });
});

describe('sidebar/runPrompt', () => {
  it('derives the companion markdown path for a saved plan', () => {
    expect(savedPlanMarkdownRelative('.mitii/plans/p.json')).toBe(
      '.mitii/plans/p.md',
    );
  });

  it('extracts plan steps only in plan mode', () => {
    expect(planFromAnswer('ask', '- one')).toBeNull();
    const plan = planFromAnswer('plan', '- first\n- second\nprose');
    expect(plan?.steps.map((s) => [s.title, s.status])).toEqual([
      ['first', 'active'],
      ['second', 'pending'],
    ]);
    expect(planFromAnswer('plan', 'just prose')?.steps).toHaveLength(1);
  });
});

describe('sidebar/tokenUsage', () => {
  function tracker(active: { run: boolean }) {
    const vs = { workspace: { getConfiguration: () => ({ get: () => undefined }) } };
    return new TokenUsageTracker({
      vs: vs as never,
      getActiveThreadId: () => 't1',
      isRunActive: () => active.run,
    });
  }

  it('starts empty and layers provisional context on the run baseline', () => {
    const t = tracker({ run: true });
    expect(t.usage.sessionTotal).toBe(0);
    t.beginRun();
    t.applyProvisionalBreakdown(
      { totalTokens: 400, contextWindow: 8000 } as never,
      8000,
    );
    expect(t.usage.live).toBe(true);
    expect(t.usage.currentTurnInputTokens).toBe(400);
    expect(t.usage.contextWindow).toBe(8000);
  });

  it('keeps an in-flight live meter when the active thread usage is refreshed', () => {
    const t = tracker({ run: true });
    t.beginRun();
    t.applyProvisionalBreakdown(
      { totalTokens: 100, contextWindow: 4000 } as never,
      4000,
    );
    t.setActiveThreadUsage(emptyTokenUsage(2000));
    expect(t.usage.live).toBe(true);
    expect(t.usage.currentTurnInputTokens).toBe(100);
  });

  it('replaces usage when no run is active', () => {
    const t = tracker({ run: false });
    t.setActiveThreadUsage({ ...emptyTokenUsage(2000), sessionTotal: 7 });
    expect(t.usage.sessionTotal).toBe(7);
    t.resetToEmpty();
    expect(t.usage.sessionTotal).toBe(0);
  });
});

describe('MitiiSidebarProvider facade', () => {
  it('exposes the active token usage snapshot', () => {
    const { provider } = createProviderHarness();
    const usage = (provider as unknown as { tokenUsage: { sessionTotal: number } })
      .tokenUsage;
    expect(usage.sessionTotal).toBe(0);
  });
});
