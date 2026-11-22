/**
 * Workspace filesystem watch — Chokidar-backed WorkspaceChangePort.
 */

import { join, relative, resolve, sep } from 'node:path';

import { watch as chokidarWatch, type FSWatcher } from 'chokidar';
import {
  isIndexLockHeld,
  type WorkspaceChangeEvent,
  type WorkspaceChangeKind,
  type WorkspaceChangePort,
} from '@mitii/host';

type Listener = (event: WorkspaceChangeEvent) => void;

const IGNORE_DIR_NAMES = new Set([
  'node_modules',
  '.git',
  '.hg',
  '.svn',
  'dist',
  'build',
  'out',
  '.next',
  '.nuxt',
  '.turbo',
  '.cache',
  'coverage',
  '.mitii',
  '.cursor',
  '.vscode',
  '__pycache__',
  '.venv',
  'venv',
]);

const COALESCE_MS_IDLE = 220;
/** While indexing holds the lock, back off explorer refresh storms. */
const COALESCE_MS_INDEXING = 480;

function shouldIgnoreRel(relPath: string): boolean {
  if (!relPath) return false;
  const parts = relPath.split(/[/\\]/).filter(Boolean);
  return parts.some((part) => IGNORE_DIR_NAMES.has(part) || part === '.DS_Store');
}

function toPosix(path: string): string {
  return path.replace(/\\/g, '/');
}

export type {
  WorkspaceChangeKind,
  WorkspaceChangeEvent,
  WorkspaceChangePort as WorkspaceWatcher,
};

/**
 * Start watching `workspaceRoot`. Events are coalesced so bursts of writes
 * produce one update with all unique relative paths.
 */
export function createWorkspaceWatcher(workspaceRoot: string): WorkspaceChangePort {
  const root = resolve(workspaceRoot);
  const mitiiDir = join(root, '.mitii');
  const listeners = new Set<Listener>();
  const pending = new Set<string>();
  let pendingKind: WorkspaceChangeKind = 'unknown';
  let timer: ReturnType<typeof setTimeout> | null = null;
  let closed = false;
  let watcher: FSWatcher | null = null;

  const coalesceMs = () =>
    isIndexLockHeld(mitiiDir).held ? COALESCE_MS_INDEXING : COALESCE_MS_IDLE;

  const flush = () => {
    timer = null;
    if (pending.size === 0 || listeners.size === 0) {
      pending.clear();
      pendingKind = 'unknown';
      return;
    }
    const paths = [...pending].sort();
    const kind = pendingKind;
    pending.clear();
    pendingKind = 'unknown';
    const event: WorkspaceChangeEvent = {
      at: Date.now(),
      paths,
      kind,
    };
    for (const listener of listeners) {
      try {
        listener(event);
      } catch {
        /* ignore subscriber errors */
      }
    }
  };

  const schedule = (relPath: string, kind: WorkspaceChangeKind) => {
    if (closed) return;
    const rel = toPosix(relPath).replace(/^\.\//, '');
    if (shouldIgnoreRel(rel)) return;
    pending.add(rel || '.');
    if (pendingKind === 'unknown') pendingKind = kind;
    else if (pendingKind !== kind) pendingKind = 'unknown';
    if (timer) clearTimeout(timer);
    timer = setTimeout(flush, coalesceMs());
  };

  const toRel = (absPath: string): string | undefined => {
    const rel = relative(root, absPath);
    if (rel.startsWith(`..${sep}`) || rel === '..') return undefined;
    return rel;
  };

  try {
    watcher = chokidarWatch(root, {
      ignoreInitial: true,
      awaitWriteFinish: { stabilityThreshold: 120, pollInterval: 50 },
      ignored: (absPath) => {
        const rel = toRel(absPath);
        if (rel === undefined) return true;
        return shouldIgnoreRel(rel);
      },
    });
    watcher
      .on('add', (absPath) => {
        const rel = toRel(absPath);
        if (rel !== undefined) schedule(rel, 'add');
      })
      .on('change', (absPath) => {
        const rel = toRel(absPath);
        if (rel !== undefined) schedule(rel, 'change');
      })
      .on('unlink', (absPath) => {
        const rel = toRel(absPath);
        if (rel !== undefined) schedule(rel, 'unlink');
      })
      .on('addDir', (absPath) => {
        const rel = toRel(absPath);
        if (rel !== undefined) schedule(rel, 'addDir');
      })
      .on('unlinkDir', (absPath) => {
        const rel = toRel(absPath);
        if (rel !== undefined) schedule(rel, 'unlinkDir');
      })
      .on('error', () => {
        /* keep process alive; subscribers just stop receiving */
      });
  } catch {
    watcher = null;
  }

  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    notify(paths, kind = 'unknown') {
      for (const path of paths) {
        schedule(path, kind);
      }
    },
    close() {
      closed = true;
      if (timer) clearTimeout(timer);
      timer = null;
      pending.clear();
      listeners.clear();
      void watcher?.close().catch(() => undefined);
      watcher = null;
    },
  };
}
