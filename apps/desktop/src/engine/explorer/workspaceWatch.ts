/**
 * Workspace filesystem watch — pushes relative path changes to subscribers.
 * Uses Node recursive fs.watch (macOS/Windows). Falls back to root-only watch.
 */

import { watch, type FSWatcher } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';

import { isIndexLockHeld } from '@mitii/host';

export type WorkspaceChangeKind =
  | 'add'
  | 'change'
  | 'unlink'
  | 'addDir'
  | 'unlinkDir'
  | 'unknown';

export interface WorkspaceChangeEvent {
  at: number;
  paths: string[];
  kind: WorkspaceChangeKind;
}

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

export interface WorkspaceWatcher {
  subscribe: (listener: Listener) => () => void;
  close: () => void;
  /** Manually publish paths (e.g. after known tool writes). */
  notify: (paths: string[], kind?: WorkspaceChangeKind) => void;
}

/**
 * Start watching `workspaceRoot`. Events are coalesced so bursts of writes
 * produce one update with all unique relative paths.
 */
export function createWorkspaceWatcher(workspaceRoot: string): WorkspaceWatcher {
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

  const onFsEvent = (eventType: string, filename: string | null) => {
    if (!filename) {
      schedule('.', 'unknown');
      return;
    }
    const abs = resolve(root, filename);
    const rel = relative(root, abs);
    if (rel.startsWith(`..${sep}`) || rel === '..') return;
    const kind: WorkspaceChangeKind =
      eventType === 'rename' ? 'unknown' : 'change';
    schedule(rel, kind);
  };

  try {
    watcher = watch(root, { recursive: true }, onFsEvent);
  } catch {
    try {
      watcher = watch(root, onFsEvent);
    } catch {
      watcher = null;
    }
  }

  watcher?.on('error', () => {
    /* keep process alive; subscribers just stop receiving */
  });

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
      try {
        watcher?.close();
      } catch {
        /* ignore */
      }
      watcher = null;
    },
  };
}
