import { mkdirSync } from 'node:fs';

import {
  IndexLockedError,
  acquireIndexLock,
  clearIndexProgress,
} from './indexLock.js';
import { runWithCorruptRetry } from './workspaceIndexCorruptRetry.js';
import { emitProgress } from './workspaceIndexProgress.js';
import type {
  FullWorkspaceIndexOptions,
  FullWorkspaceIndexResult,
} from './workspaceIndexTypes.js';
import { skippedFromPreviousMetadata } from './workspaceIndexUnchanged.js';

export {
  estimateIndexProgressPercent,
  type WorkspaceIndexProgress,
  type WorkspaceIndexProgressStage,
} from './workspaceIndexProgress.js';
export type {
  FullWorkspaceIndexOptions,
  FullWorkspaceIndexResult,
} from './workspaceIndexTypes.js';

export async function runFullWorkspaceIndex(
  options: FullWorkspaceIndexOptions,
): Promise<FullWorkspaceIndexResult> {
  mkdirSync(options.mitiiDir, { recursive: true });
  emitProgress(options.mitiiDir, options.onProgress, {
    stage: 'locking',
    message: 'Acquiring index lock',
  });

  let lock;
  try {
    lock = acquireIndexLock(options.mitiiDir);
  } catch (error) {
    // Full and incremental callers share one disk lock. Returning skipped with
    // prior metadata avoids treating contention as a hard failure (which used
    // to force host_snapshot → needsFullIndexRefresh loops in the VS Code host).
    if (error instanceof IndexLockedError) {
      const skipped = skippedFromPreviousMetadata(options);
      if (skipped) return skipped;
    }
    throw error;
  }

  try {
    const result = await runWithCorruptRetry(options);
    emitProgress(options.mitiiDir, options.onProgress, {
      stage: result.status === 'cancelled' ? 'cancelled' : 'complete',
      message:
        result.status === 'cancelled'
          ? 'Indexing cancelled'
          : result.status === 'unchanged'
            ? 'Index unchanged'
            : `Indexed ${result.fileCount} files`,
      fileCount: result.fileCount,
      percent: result.status === 'cancelled' ? 0 : 100,
    });
    if (result.status !== 'cancelled') {
      clearIndexProgress(options.mitiiDir);
    }
    return result;
  } finally {
    lock.release();
  }
}
