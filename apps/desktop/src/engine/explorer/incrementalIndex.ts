/**
 * Debounced FS-change → scoped workspace index (Desktop incremental path).
 * Uses shared `@mitii/host` coalescer + Desktop reindexWorkspace.
 */

import { join } from 'node:path';

import {
  createDebouncedIncrementalIndexTrigger,
  type SemanticIndexSettings,
  type WorkspaceChangeEvent,
  type WorkspaceChangePort,
} from '@mitii/host';

import { reindexWorkspace } from '../index-status.js';
import {
  appendDesktopLog,
  errorMessage,
  resolveLogsDir,
} from '../../shared/project-logs.js';

export interface IncrementalIndexController {
  dispose: () => void;
}

export function startIncrementalWorkspaceIndex(options: {
  workspaceRoot: string;
  watcher: WorkspaceChangePort;
  resolveSemanticIndex: () => SemanticIndexSettings | undefined;
  resolveMaximumFiles?: () => number | undefined;
  resolveConcurrency?: () => number | undefined;
  onProgress?: Parameters<typeof reindexWorkspace>[0]['onProgress'];
}): IncrementalIndexController {
  const trigger = createDebouncedIncrementalIndexTrigger({
    workspaceRoot: options.workspaceRoot,
    onFlush: async (filePaths) => {
      await reindexWorkspace({
        workspaceRoot: options.workspaceRoot,
        filePaths: [...filePaths],
        force: false,
        preempt: false,
        maximumFiles: options.resolveMaximumFiles?.(),
        concurrency: options.resolveConcurrency?.(),
        semanticIndex: options.resolveSemanticIndex(),
        onProgress: options.onProgress,
      });
    },
    onError: (error, filePaths) => {
      const message = errorMessage(error);
      if (!/already running|index\.lock|IndexLocked/i.test(message)) {
        appendDesktopLog(
          resolveLogsDir(undefined, process.env) ??
            join(options.workspaceRoot, '.mitii', 'logs'),
          'indexing',
          `incremental_failed ${message}`,
          {
            level: 'error',
            mirrorRuns: true,
            extra: { pathCount: filePaths.length },
          },
        );
      }
    },
  });

  const unsubscribe = options.watcher.subscribe(
    (event: WorkspaceChangeEvent) => {
      trigger.notify(event.paths);
    },
  );

  return {
    dispose() {
      unsubscribe();
      trigger.dispose();
    },
  };
}
