/**
 * Durable memory resource leases under `.mitii/memory/leases.json`.
 *
 * Inspired by agentmemory lease-acquire/release/renew (TTL + holder),
 * adapted to Mitii host paths — gates consolidate / pending approve
 * so concurrent hosts do not race RMW on facts/pending.
 */

import { randomBytes } from 'node:crypto';
import {
  mkdir,
  readFile,
  rename,
  rm,
  stat,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { dirname, join } from 'node:path';

const STORAGE_VERSION = 1 as const;
const LEASES_FILE = 'leases.json';
const LOCKS_DIR = 'lease-locks';
const LOCK_OWNER_FILE = 'owner.json';
const DEFAULT_TTL_MS = 10 * 60 * 1000;
const MAX_TTL_MS = 60 * 60 * 1000;
const INCOMPLETE_LOCK_STALE_MS = 60_000;

export const MEMORY_LEASE_RESOURCES = [
  'memory:consolidate',
  'memory:approve_pending',
] as const;

export type MemoryLeaseResource = (typeof MEMORY_LEASE_RESOURCES)[number];

export interface MemoryLease {
  id: string;
  resource: MemoryLeaseResource;
  holderId: string;
  acquiredAt: string;
  expiresAt: string;
  status: 'active' | 'released' | 'expired';
  renewedAt?: string;
}

interface LeasesEnvelope {
  storageVersion: typeof STORAGE_VERSION;
  leases: MemoryLease[];
}

interface LockOwner {
  storageVersion: typeof STORAGE_VERSION;
  id: string;
  resource: MemoryLeaseResource;
  holderId: string;
  acquiredAt: string;
  expiresAt: string;
}

export type LeaseAcquireResult =
  | { ok: true; lease: MemoryLease; renewed: boolean }
  | { ok: false; error: string; heldBy?: string; expiresAt?: string };

export type LeaseReleaseResult =
  | { ok: true; released: boolean }
  | { ok: false; error: string };

class MutationQueue {
  private chain: Promise<unknown> = Promise.resolve();

  public enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.chain.then(operation, operation);
    this.chain = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}

function leasesPath(workspaceRoot: string): string {
  return join(workspaceRoot, '.mitii', 'memory', LEASES_FILE);
}

function lockPath(workspaceRoot: string, resource: MemoryLeaseResource): string {
  return join(
    workspaceRoot,
    '.mitii',
    'memory',
    LOCKS_DIR,
    `${resource.replace(/[^a-zA-Z0-9_.-]+/g, '_')}.lock`,
  );
}

function clampTtl(ttlMs?: number): number {
  const raw =
    typeof ttlMs === 'number' && Number.isFinite(ttlMs) && ttlMs > 0
      ? ttlMs
      : DEFAULT_TTL_MS;
  return Math.min(raw, MAX_TTL_MS);
}

function isActive(lease: MemoryLease, nowMs: number): boolean {
  return (
    lease.status === 'active' &&
    new Date(lease.expiresAt).getTime() > nowMs
  );
}

/**
 * File-backed lease store for one workspace.
 */
export class FileWorkspaceMemoryLeaseStore {
  private readonly filePath: string;
  private readonly workspaceRoot: string;
  private readonly mutations = new MutationQueue();

  constructor(workspaceRoot: string) {
    this.workspaceRoot = workspaceRoot;
    this.filePath = leasesPath(workspaceRoot);
  }

  public async acquire(input: {
    resource: MemoryLeaseResource;
    holderId: string;
    ttlMs?: number;
    now?: Date;
  }): Promise<LeaseAcquireResult> {
    const holderId = input.holderId.trim();
    if (!holderId) {
      return { ok: false, error: 'holderId is required' };
    }
    if (!MEMORY_LEASE_RESOURCES.includes(input.resource)) {
      return { ok: false, error: `unknown resource: ${input.resource}` };
    }

    return this.mutations.enqueue(async () => {
      const now = input.now ?? new Date();
      const nowMs = now.getTime();
      const ttl = clampTtl(input.ttlMs);
      const locked = await this.acquireResourceLock({
        resource: input.resource,
        holderId,
        now,
        ttlMs: ttl,
      });
      if (!locked.ok) {
        return locked;
      }
      const envelope = await this.readEnvelope();
      const leases = expireStale(envelope.leases, nowMs);

      const active = leases.find(
        (lease) =>
          lease.resource === input.resource && isActive(lease, nowMs),
      );

      if (active) {
        if (active.holderId === holderId) {
          return { ok: true, lease: active, renewed: false };
        }
        await this.releaseResourceLock(input.resource, holderId);
        return {
          ok: false,
          error: 'resource already leased',
          heldBy: active.holderId,
          expiresAt: active.expiresAt,
        };
      }

      const lease: MemoryLease = {
        id: locked.owner.id,
        resource: input.resource,
        holderId,
        acquiredAt: locked.owner.acquiredAt,
        expiresAt: locked.owner.expiresAt,
        status: 'active',
      };
      await this.writeEnvelope({
        storageVersion: STORAGE_VERSION,
        leases: [...leases.filter((l) => l.id !== lease.id), lease],
      });
      return { ok: true, lease, renewed: false };
    });
  }

  public async release(input: {
    resource: MemoryLeaseResource;
    holderId: string;
    now?: Date;
  }): Promise<LeaseReleaseResult> {
    const holderId = input.holderId.trim();
    if (!holderId) {
      return { ok: false, error: 'holderId is required' };
    }

    return this.mutations.enqueue(async () => {
      const now = input.now ?? new Date();
      const nowMs = now.getTime();
      const envelope = await this.readEnvelope();
      const leases = expireStale(envelope.leases, nowMs);
      const active = leases.find(
        (lease) =>
          lease.resource === input.resource &&
          lease.holderId === holderId &&
          isActive(lease, nowMs),
      );
      if (!active) {
        return { ok: false, error: 'no active lease found for this holder' };
      }
      active.status = 'released';
      await this.writeEnvelope({
        storageVersion: STORAGE_VERSION,
        leases,
      });
      await this.releaseResourceLock(input.resource, holderId);
      return { ok: true, released: true };
    });
  }

  public async renew(input: {
    resource: MemoryLeaseResource;
    holderId: string;
    ttlMs?: number;
    now?: Date;
  }): Promise<LeaseAcquireResult> {
    const holderId = input.holderId.trim();
    if (!holderId) {
      return { ok: false, error: 'holderId is required' };
    }

    return this.mutations.enqueue(async () => {
      const now = input.now ?? new Date();
      const nowMs = now.getTime();
      const ttl = clampTtl(input.ttlMs);
      const envelope = await this.readEnvelope();
      const leases = expireStale(envelope.leases, nowMs);
      const active = leases.find(
        (lease) =>
          lease.resource === input.resource &&
          lease.holderId === holderId &&
          isActive(lease, nowMs),
      );
      if (!active) {
        return { ok: false, error: 'no active (non-expired) lease to renew' };
      }
      const base = Math.max(nowMs, new Date(active.expiresAt).getTime());
      active.expiresAt = new Date(base + ttl).toISOString();
      active.renewedAt = now.toISOString();
      await this.writeLockOwner({
        storageVersion: STORAGE_VERSION,
        id: active.id,
        resource: active.resource,
        holderId: active.holderId,
        acquiredAt: active.acquiredAt,
        expiresAt: active.expiresAt,
      });
      await this.writeEnvelope({
        storageVersion: STORAGE_VERSION,
        leases,
      });
      return { ok: true, lease: active, renewed: true };
    });
  }

  /** Run `fn` while holding a lease; always release (best-effort) afterward. */
  public async withLease<T>(input: {
    resource: MemoryLeaseResource;
    holderId: string;
    ttlMs?: number;
    fn: () => Promise<T>;
  }): Promise<{ ok: true; value: T } | { ok: false; error: string }> {
    const acquired = await this.acquire(input);
    if (!acquired.ok) {
      return { ok: false, error: acquired.error };
    }
    try {
      const value = await input.fn();
      return { ok: true, value };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      };
    } finally {
      await this.release({
        resource: input.resource,
        holderId: input.holderId,
      }).catch(() => undefined);
    }
  }

  private async readEnvelope(): Promise<LeasesEnvelope> {
    try {
      const raw = await readFile(this.filePath, 'utf8');
      const parsed = JSON.parse(raw) as LeasesEnvelope;
      if (
        !parsed ||
        parsed.storageVersion !== STORAGE_VERSION ||
        !Array.isArray(parsed.leases)
      ) {
        return { storageVersion: STORAGE_VERSION, leases: [] };
      }
      return {
        storageVersion: STORAGE_VERSION,
        leases: parsed.leases.filter(isLeaseShape),
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return { storageVersion: STORAGE_VERSION, leases: [] };
      }
      return { storageVersion: STORAGE_VERSION, leases: [] };
    }
  }

  private async writeEnvelope(envelope: LeasesEnvelope): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    const tempPath = `${this.filePath}.${process.pid}.${randomBytes(8).toString('hex')}.tmp`;
    try {
      await writeFile(
        tempPath,
        `${JSON.stringify(envelope, null, 2)}\n`,
        'utf8',
      );
      await rename(tempPath, this.filePath);
    } catch (error) {
      await unlink(tempPath).catch(() => undefined);
      throw error;
    }
  }

  private async acquireResourceLock(input: {
    resource: MemoryLeaseResource;
    holderId: string;
    now: Date;
    ttlMs: number;
  }): Promise<
    | { ok: true; owner: LockOwner }
    | { ok: false; error: string; heldBy?: string; expiresAt?: string }
  > {
    const path = lockPath(this.workspaceRoot, input.resource);
    const parent = dirname(path);

    for (let attempt = 0; attempt < 2; attempt += 1) {
      await mkdir(parent, { recursive: true });
      try {
        await mkdir(path);
        const owner: LockOwner = {
          storageVersion: STORAGE_VERSION,
          id: `lse_${randomBytes(8).toString('hex')}`,
          resource: input.resource,
          holderId: input.holderId,
          acquiredAt: input.now.toISOString(),
          expiresAt: new Date(input.now.getTime() + input.ttlMs).toISOString(),
        };
        await this.writeLockOwner(owner);
        return { ok: true, owner };
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
          return {
            ok: false,
            error: error instanceof Error ? error.message : String(error),
          };
        }
      }

      const owner = await this.readLockOwner(input.resource);
      const nowMs = input.now.getTime();
      if (owner && new Date(owner.expiresAt).getTime() > nowMs) {
        if (owner.holderId === input.holderId) {
          return { ok: true, owner };
        }
        return {
          ok: false,
          error: 'resource already leased',
          heldBy: owner.holderId,
          expiresAt: owner.expiresAt,
        };
      }

      if (!owner && !(await this.incompleteLockLooksStale(path, nowMs))) {
        return { ok: false, error: 'resource lock is being initialized' };
      }

      await rm(path, { recursive: true, force: true });
    }

    return { ok: false, error: 'resource already leased' };
  }

  private async releaseResourceLock(
    resource: MemoryLeaseResource,
    holderId: string,
  ): Promise<void> {
    const owner = await this.readLockOwner(resource);
    if (owner && owner.holderId !== holderId) return;
    await rm(lockPath(this.workspaceRoot, resource), {
      recursive: true,
      force: true,
    });
  }

  private async readLockOwner(
    resource: MemoryLeaseResource,
  ): Promise<LockOwner | undefined> {
    try {
      const raw = await readFile(
        join(lockPath(this.workspaceRoot, resource), LOCK_OWNER_FILE),
        'utf8',
      );
      const parsed = JSON.parse(raw) as LockOwner;
      if (
        parsed?.storageVersion !== STORAGE_VERSION ||
        parsed.resource !== resource ||
        typeof parsed.id !== 'string' ||
        typeof parsed.holderId !== 'string' ||
        typeof parsed.acquiredAt !== 'string' ||
        typeof parsed.expiresAt !== 'string'
      ) {
        return undefined;
      }
      return parsed;
    } catch {
      return undefined;
    }
  }

  private async writeLockOwner(owner: LockOwner): Promise<void> {
    const path = lockPath(this.workspaceRoot, owner.resource);
    await mkdir(path, { recursive: true });
    await writeFile(
      join(path, LOCK_OWNER_FILE),
      `${JSON.stringify(owner, null, 2)}\n`,
      'utf8',
    );
  }

  private async incompleteLockLooksStale(
    path: string,
    nowMs: number,
  ): Promise<boolean> {
    try {
      const info = await stat(path);
      return nowMs - info.mtimeMs > INCOMPLETE_LOCK_STALE_MS;
    } catch {
      return true;
    }
  }
}

function expireStale(
  leases: MemoryLease[],
  nowMs: number,
): MemoryLease[] {
  return leases.map((lease) => {
    if (
      lease.status === 'active' &&
      new Date(lease.expiresAt).getTime() <= nowMs
    ) {
      return { ...lease, status: 'expired' as const };
    }
    return lease;
  });
}

function isLeaseShape(value: unknown): value is MemoryLease {
  if (!value || typeof value !== 'object') return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row.id === 'string' &&
    typeof row.resource === 'string' &&
    typeof row.holderId === 'string' &&
    typeof row.acquiredAt === 'string' &&
    typeof row.expiresAt === 'string' &&
    (row.status === 'active' ||
      row.status === 'released' ||
      row.status === 'expired')
  );
}

export function createWorkspaceMemoryLeaseStore(
  workspaceRoot: string,
): FileWorkspaceMemoryLeaseStore {
  return new FileWorkspaceMemoryLeaseStore(workspaceRoot);
}
