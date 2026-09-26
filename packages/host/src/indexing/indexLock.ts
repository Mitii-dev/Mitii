import {
  existsSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';

export const INDEX_LOCK_FILE = 'index.lock';
export const INDEX_LOCK_STALE_MS = 30 * 60 * 1000;
export const INDEX_PROGRESS_FILE = 'index-progress.json';

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

export function indexLockPath(mitiiDir: string): string {
  return join(mitiiDir, INDEX_LOCK_FILE);
}

export function indexProgressPath(mitiiDir: string): string {
  return join(mitiiDir, INDEX_PROGRESS_FILE);
}

/** Read lock metadata if the lock file exists (does not clear stale locks). */
export function readIndexLockInfo(mitiiDir: string): IndexLockInfo | undefined {
  const lockPath = indexLockPath(mitiiDir);
  if (!existsSync(lockPath)) return undefined;
  return readLockInfo(lockPath);
}

function isProcessAlive(pid: number): boolean {
  if (!Number.isFinite(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * True when another live indexer holds the lock.
 * Dead PIDs (or over-age locks) are cleared so a killed reindex cannot stick forever.
 */
export function isIndexLockHeld(
  mitiiDir: string,
  options: { now?: number; staleMs?: number } = {},
): { held: boolean; info?: IndexLockInfo; lockPath: string } {
  const lockPath = indexLockPath(mitiiDir);
  const now = options.now ?? Date.now();
  const staleMs = options.staleMs ?? INDEX_LOCK_STALE_MS;
  if (!existsSync(lockPath)) {
    return { held: false, lockPath };
  }
  const existing = readLockInfo(lockPath);
  if (!existing) {
    try {
      unlinkSync(lockPath);
    } catch {
      /* ignore */
    }
    return { held: false, lockPath };
  }
  const age = now - existing.startedAt;
  const alive = isProcessAlive(existing.pid);
  if (!alive || age > staleMs) {
    try {
      unlinkSync(lockPath);
    } catch {
      /* ignore */
    }
    return { held: false, lockPath };
  }
  return { held: true, info: existing, lockPath };
}

export function acquireIndexLock(
  mitiiDir: string,
  options: {
    now?: number;
    staleMs?: number;
  } = {},
): IndexLockHandle {
  const lockPath = indexLockPath(mitiiDir);
  const now = options.now ?? Date.now();
  const staleMs = options.staleMs ?? INDEX_LOCK_STALE_MS;

  const prior = isIndexLockHeld(mitiiDir, { now, staleMs });
  if (prior.held && prior.info) {
    throw new IndexLockedError(lockPath, prior.info.startedAt);
  }

  const info: IndexLockInfo = {
    pid: process.pid,
    startedAt: now,
  };

  try {
    writeFileSync(lockPath, `${JSON.stringify(info)}\n`, { flag: 'wx' });
  } catch {
    const existing = readLockInfo(lockPath);
    if (existing && isProcessAlive(existing.pid)) {
      throw new IndexLockedError(lockPath, existing.startedAt);
    }
    try {
      unlinkSync(lockPath);
      writeFileSync(lockPath, `${JSON.stringify(info)}\n`, { flag: 'wx' });
    } catch {
      const again = readLockInfo(lockPath);
      throw new IndexLockedError(lockPath, again?.startedAt ?? now);
    }
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

export interface IndexProgressSnapshot {
  stage: string;
  message: string;
  percent: number;
  fileCount?: number;
  lexicalReady?: boolean;
  embeddingPhase?: string;
  updatedAt: number;
}

export function writeIndexProgress(
  mitiiDir: string,
  progress: Omit<IndexProgressSnapshot, 'updatedAt'> & { updatedAt?: number },
): void {
  try {
    writeFileSync(
      indexProgressPath(mitiiDir),
      `${JSON.stringify({
        ...progress,
        updatedAt: progress.updatedAt ?? Date.now(),
      })}\n`,
      'utf8',
    );
  } catch {
    /* non-fatal */
  }
}

export function readIndexProgress(
  mitiiDir: string,
): IndexProgressSnapshot | undefined {
  try {
    const path = indexProgressPath(mitiiDir);
    if (!existsSync(path)) return undefined;
    const parsed = JSON.parse(
      readFileSync(path, 'utf8'),
    ) as Partial<IndexProgressSnapshot>;
    if (
      typeof parsed.stage !== 'string' ||
      typeof parsed.message !== 'string' ||
      typeof parsed.percent !== 'number'
    ) {
      return undefined;
    }
    return {
      stage: parsed.stage,
      message: parsed.message,
      percent: parsed.percent,
      updatedAt:
        typeof parsed.updatedAt === 'number' ? parsed.updatedAt : Date.now(),
      ...(typeof parsed.fileCount === 'number'
        ? { fileCount: parsed.fileCount }
        : {}),
      ...(parsed.lexicalReady === true ? { lexicalReady: true } : {}),
      ...(typeof parsed.embeddingPhase === 'string'
        ? { embeddingPhase: parsed.embeddingPhase }
        : {}),
    };
  } catch {
    return undefined;
  }
}

export function clearIndexProgress(mitiiDir: string): void {
  try {
    unlinkSync(indexProgressPath(mitiiDir));
  } catch {
    /* ignore */
  }
}

function readLockInfo(lockPath: string): IndexLockInfo | undefined {
  try {
    const parsed = JSON.parse(
      readFileSync(lockPath, 'utf8'),
    ) as Partial<IndexLockInfo>;
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
