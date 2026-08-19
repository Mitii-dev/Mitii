import {
  existsSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';

export const INDEX_LOCK_FILE = 'index.lock';
export const INDEX_LOCK_STALE_MS = 30 * 60 * 1000;

export interface IndexLockInfo {
  pid: number;
  startedAt: number;
  hostname?: string;
}

export class IndexLockedError extends Error {
  readonly lockPath: string;
  readonly startedAt: number;

  constructor(lockPath: string, startedAt: number) {
    super(`Workspace indexing is already running (lock ${lockPath}).`);
    this.name = 'IndexLockedError';
    this.lockPath = lockPath;
    this.startedAt = startedAt;
  }
}

export interface IndexLockHandle {
  readonly lockPath: string;
  release(): void;
}

export function acquireIndexLock(
  mitiiDir: string,
  options: {
    now?: number;
    staleMs?: number;
  } = {},
): IndexLockHandle {
  const lockPath = join(mitiiDir, INDEX_LOCK_FILE);
  const now = options.now ?? Date.now();
  const staleMs = options.staleMs ?? INDEX_LOCK_STALE_MS;

  if (existsSync(lockPath)) {
    const existing = readLockInfo(lockPath);
    const age = existing ? now - existing.startedAt : staleMs + 1;
    if (age <= staleMs && existing) {
      throw new IndexLockedError(lockPath, existing.startedAt);
    }
    try {
      unlinkSync(lockPath);
    } catch {
      // Another process may have already removed a stale lock.
    }
  }

  const info: IndexLockInfo = {
    pid: process.pid,
    startedAt: now,
  };

  try {
    writeFileSync(lockPath, `${JSON.stringify(info)}\n`, { flag: 'wx' });
  } catch {
    const existing = readLockInfo(lockPath);
    throw new IndexLockedError(lockPath, existing?.startedAt ?? now);
  }

  let released = false;
  return {
    lockPath,
    release() {
      if (released) return;
      released = true;
      try {
        unlinkSync(lockPath);
      } catch {
        // Lock may already have been cleared.
      }
    },
  };
}

function readLockInfo(lockPath: string): IndexLockInfo | undefined {
  try {
    const parsed = JSON.parse(readFileSync(lockPath, 'utf8')) as Partial<IndexLockInfo>;
    if (
      typeof parsed.pid === 'number' &&
      typeof parsed.startedAt === 'number' &&
      Number.isFinite(parsed.startedAt)
    ) {
      return {
        pid: parsed.pid,
        startedAt: parsed.startedAt,
        ...(typeof parsed.hostname === 'string'
          ? { hostname: parsed.hostname }
          : {}),
      };
    }
  } catch {
    return undefined;
  }
  return undefined;
}
