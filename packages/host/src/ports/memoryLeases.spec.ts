import { describe, expect, it } from 'vitest';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createWorkspaceMemoryLeaseStore } from './memoryLeases.js';

describe('FileWorkspaceMemoryLeaseStore', () => {
  it('acquires, blocks second holder, releases, then allows reacquire', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mitii-lease-'));
    const store = createWorkspaceMemoryLeaseStore(root);

    const first = await store.acquire({
      resource: 'memory:consolidate',
      holderId: 'agent-a',
      ttlMs: 60_000,
    });
    expect(first.ok).toBe(true);

    const blocked = await store.acquire({
      resource: 'memory:consolidate',
      holderId: 'agent-b',
      ttlMs: 60_000,
    });
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) {
      expect(blocked.heldBy).toBe('agent-a');
    }

    const released = await store.release({
      resource: 'memory:consolidate',
      holderId: 'agent-a',
    });
    expect(released.ok).toBe(true);

    const second = await store.acquire({
      resource: 'memory:consolidate',
      holderId: 'agent-b',
      ttlMs: 60_000,
    });
    expect(second.ok).toBe(true);
  });

  it('blocks a second store instance for the same workspace', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mitii-lease-'));
    const firstStore = createWorkspaceMemoryLeaseStore(root);
    const secondStore = createWorkspaceMemoryLeaseStore(root);

    const first = await firstStore.acquire({
      resource: 'memory:consolidate',
      holderId: 'agent-a',
      ttlMs: 60_000,
    });
    expect(first.ok).toBe(true);

    const blocked = await secondStore.acquire({
      resource: 'memory:consolidate',
      holderId: 'agent-b',
      ttlMs: 60_000,
    });
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) {
      expect(blocked.heldBy).toBe('agent-a');
    }
  });

  it('same holder re-acquire is idempotent', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mitii-lease-'));
    const store = createWorkspaceMemoryLeaseStore(root);
    const a = await store.acquire({
      resource: 'memory:approve_pending',
      holderId: 'cli',
    });
    const b = await store.acquire({
      resource: 'memory:approve_pending',
      holderId: 'cli',
    });
    expect(a.ok && b.ok).toBe(true);
    if (a.ok && b.ok) {
      expect(a.lease.id).toBe(b.lease.id);
      expect(b.renewed).toBe(false);
    }
  });

  it('withLease releases even when fn throws', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mitii-lease-'));
    const store = createWorkspaceMemoryLeaseStore(root);
    const result = await store.withLease({
      resource: 'memory:consolidate',
      holderId: 'worker',
      fn: async () => {
        throw new Error('boom');
      },
    });
    expect(result.ok).toBe(false);

    const next = await store.acquire({
      resource: 'memory:consolidate',
      holderId: 'other',
    });
    expect(next.ok).toBe(true);
  });

  it('expires leases after ttl', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mitii-lease-'));
    const store = createWorkspaceMemoryLeaseStore(root);
    const t0 = new Date('2026-01-01T00:00:00.000Z');
    await store.acquire({
      resource: 'memory:consolidate',
      holderId: 'a',
      ttlMs: 1_000,
      now: t0,
    });
    const later = new Date(t0.getTime() + 5_000);
    const next = await store.acquire({
      resource: 'memory:consolidate',
      holderId: 'b',
      now: later,
    });
    expect(next.ok).toBe(true);
  });
});
