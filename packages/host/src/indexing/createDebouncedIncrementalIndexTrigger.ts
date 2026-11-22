/**
 * Shared debounced path coalescer for host incremental indexing.
 * Desktop / VS Code feed file paths; one flush runs the host-supplied indexer.
 */

import { join } from "node:path";

import { isIndexLockHeld } from "./indexLock.js";

export const INCREMENTAL_INDEX_DEBOUNCE_MS = 750;
export const INCREMENTAL_INDEX_MAX_PATHS_PER_FLUSH = 400;

export interface DebouncedIncrementalIndexTrigger {
  /** Queue relative workspace paths for a scoped refresh. */
  notify(paths: readonly string[]): void;
  dispose(): void;
}

export interface CreateDebouncedIncrementalIndexTriggerOptions {
  workspaceRoot: string;
  /** Debounce idle before flush (default 750ms). */
  debounceMs?: number;
  /** Cap paths per flush (default 400). */
  maxPathsPerFlush?: number;
  /**
   * When true (default), if `.mitii/index.lock` is held, re-arm the timer
   * instead of flushing (never preempt a full index).
   */
  respectIndexLock?: boolean;
  /** Invoked with the coalesced relative paths. */
  onFlush: (filePaths: readonly string[]) => void | Promise<void>;
  /** Optional error sink for flush failures. */
  onError?: (error: unknown, filePaths: readonly string[]) => void;
}

export function createDebouncedIncrementalIndexTrigger(
  options: CreateDebouncedIncrementalIndexTriggerOptions,
): DebouncedIncrementalIndexTrigger {
  const debounceMs = options.debounceMs ?? INCREMENTAL_INDEX_DEBOUNCE_MS;
  const maxPaths =
    options.maxPathsPerFlush ?? INCREMENTAL_INDEX_MAX_PATHS_PER_FLUSH;
  const respectLock = options.respectIndexLock !== false;
  const mitiiDir = join(options.workspaceRoot, ".mitii");

  const pending = new Set<string>();
  let timer: ReturnType<typeof setTimeout> | null = null;
  let disposed = false;
  let inFlight: Promise<void> | null = null;

  const flush = (): void => {
    timer = null;
    if (disposed || pending.size === 0) {
      pending.clear();
      return;
    }

    if (respectLock && isIndexLockHeld(mitiiDir).held) {
      timer = setTimeout(flush, debounceMs);
      return;
    }

    const filePaths = [...pending]
      .filter((p) => p && p !== ".")
      .slice(0, maxPaths);
    pending.clear();
    if (filePaths.length === 0) return;

    const run = async (): Promise<void> => {
      try {
        await options.onFlush(filePaths);
      } catch (error) {
        options.onError?.(error, filePaths);
      }
    };

    inFlight = (inFlight ?? Promise.resolve())
      .then(run, run)
      .then(() => {
        inFlight = null;
      });
  };

  return {
    notify(paths) {
      if (disposed) return;
      for (const path of paths) {
        if (!path || path === ".") continue;
        pending.add(path);
      }
      if (pending.size === 0) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(flush, debounceMs);
    },
    dispose() {
      disposed = true;
      if (timer) clearTimeout(timer);
      timer = null;
      pending.clear();
    },
  };
}
