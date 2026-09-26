/**
 * Debounced FS-change → scoped workspace index (Desktop incremental path).
 *
 * Mirrors VS Code's save-scoped refresh: coalesce path bursts, then call
 * `runFullWorkspaceIndex({ filePaths, force: false })` without a full rebuild.
 */

import { join } from 'node:path';

import { isIndexLockHeld, type SemanticIndexSettings } from '@mitii/host';

import type { WorkspaceChangeEvent, WorkspaceWatcher } from './workspaceWatch.js';
import { reindexWorkspace } from '../index-status.js';

const INCREMENTAL_INDEX_DEBOUNCE_MS = 750;
const MAX_PATHS_PER_FLUSH = 400;

export interface IncrementalIndexController {
  dispose: () => void;
}

export function startIncrementalWorkspaceIndex(options: {
  workspaceRoot: string;
  watcher: WorkspaceWatcher;
  resolveSemanticIndex: () => SemanticIndexSettings | undefined;
  resolveMaximumFiles?: () => number | undefined;
  resolveConcurrency?: () => number | undefined;
  onProgress?: Parameters<typeof reindexWorkspace>[0]['onProgress'];
}): IncrementalIndexController {
  const pending = new Set<string>();
  let timer: ReturnType<typeof setTimeout> | null = null;
  let disposed = false;
  let inFlight: Promise<void> | null = null;

  const flush = () => {
    timer = null;
    if (disposed || pending.size === 0) {
      pending.clear();
      return;
    }

    const mitiiDir = join(options.workspaceRoot, '.mitii');
    // Never preempt a full/manual index — re-queue until the lock clears.
    if (isIndexLockHeld(mitiiDir).held) {
      if (timer) clearTimeout(timer);
      timer = setTimeout(flush, INCREMENTAL_INDEX_DEBOUNCE_MS);
      return;
    }

    const filePaths = [...pending]
      .filter((p) => p && p !== '.')
      .slice(0, MAX_PATHS_PER_FLUSH);
    pending.clear();
    if (filePaths.length === 0) return;

    const run = async () => {
      try {
        await reindexWorkspace({
          workspaceRoot: options.workspaceRoot,
          filePaths,
          force: false,
          preempt: false,
          maximumFiles: options.resolveMaximumFiles?.(),
          concurrency: options.resolveConcurrency?.(),
          semanticIndex: options.resolveSemanticIndex(),
          onProgress: options.onProgress,
        });
      } catch {
        /* lock contention / transient — next FS event retries */
      }
    };

    inFlight = (inFlight ?? Promise.resolve())
      .then(run, run)
      .then(() => {
        inFlight = null;
      });
  };

  const schedule = (event: WorkspaceChangeEvent) => {
    if (disposed) return;
    for (const path of event.paths) {
      if (!path || path === '.') continue;
      pending.add(path);
    }
    if (timer) clearTimeout(timer);
    timer = setTimeout(flush, INCREMENTAL_INDEX_DEBOUNCE_MS);
  };

  const unsubscribe = options.watcher.subscribe(schedule);

  return {
    dispose() {
      disposed = true;
      unsubscribe();
      if (timer) clearTimeout(timer);
      timer = null;
      pending.clear();
    },
  };
}
