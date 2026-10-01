/**
 * Index status + reindex for Desktop engine.
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';

import {
  clearIndexProgress,
  estimateIndexProgressPercent,
  IndexLockedError,
  isIndexLockHeld,
  readIndexPipelineHealth,
  readIndexProgress,
  readIndexRuntimeMetadata,
  runFullWorkspaceIndex,
  type IndexPipelineHealth,
  type SemanticIndexSettings,
  type WorkspaceIndexProgress,
} from '@mitii/host';
import Database from 'better-sqlite3';

import {
  appendDesktopLog,
  errorMessage,
  resolveLogsDir,
} from '../shared/project-logs.js';
import { workspaceIdFromRoot } from './workspace-id.js';
import { openDesktopStore } from './desktop-store.js';

function indexLogsDir(workspaceRoot: string): string | undefined {
  return (
    resolveLogsDir(undefined, process.env) ??
    join(workspaceRoot, '.mitii', 'logs')
  );
}

export interface DesktopIndexStatus {
  indexed: boolean;
  fileCount: number;
  truncated: boolean;
  lastIndexedAt?: string;
  message: string;
  sqlitePath?: string;
  embeddingError?: string;
  /** True when index.lock is held by a live process. */
  running?: boolean;
  lockStartedAt?: number;
  progressPercent?: number;
  progressStage?: string;
  progressMessage?: string;
  /** FTS/symbols usable while embeddings may still run. */
  lexicalReady?: boolean;
  embeddingPhase?: string;
  /** Shared pipeline board (Code / FTS / Embeddings / native). */
  health?: IndexPipelineHealth;
}

/** Active reindex abort controller (module-level for pause route). */
let activeReindexAbort: AbortController | undefined;

/** Abort the in-flight reindex, if any. */
export function pauseWorkspaceIndex(): {
  paused: boolean;
  message: string;
} {
  if (!activeReindexAbort) {
    return {
      paused: false,
      message: 'No active index run to pause.',
    };
  }
  activeReindexAbort.abort();
  return {
    paused: true,
    message: 'Pause requested — finishing the current file, then stopping.',
  };
}

export function getIndexStatus(workspaceRoot: string): DesktopIndexStatus {
  const mitiiDir = join(workspaceRoot, '.mitii');
  const lock = isIndexLockHeld(mitiiDir);
  const progress = lock.held ? readIndexProgress(mitiiDir) : undefined;
  const health = readIndexPipelineHealth({ workspaceRoot });

  const metaPath = join(mitiiDir, 'index-runtime.json');
  const meta = readIndexRuntimeMetadata(metaPath);

  const runningFields =
    lock.held
      ? {
          running: true as const,
          ...(lock.info ? { lockStartedAt: lock.info.startedAt } : {}),
          ...(progress
            ? {
                progressPercent: progress.percent,
                progressStage: progress.stage,
                progressMessage: progress.message,
                ...(progress.lexicalReady ? { lexicalReady: true } : {}),
                ...(progress.embeddingPhase
                  ? { embeddingPhase: progress.embeddingPhase }
                  : {}),
              }
            : {
                progressPercent: 8,
                progressStage: 'indexing',
                progressMessage: 'Indexing in progress…',
              }),
        }
      : { running: false as const };

  if (!meta) {
    const sqliteFallback = join(mitiiDir, 'repository-index.sqlite');
    if (existsSync(sqliteFallback)) {
      return {
        indexed: true,
        fileCount: health.counts.files,
        truncated: health.counts.truncated,
        message: runningFields.running
          ? runningFields.progressMessage ?? 'Indexing in progress…'
          : 'Index database present (metadata missing). Reindex recommended.',
        sqlitePath: sqliteFallback,
        health,
        ...runningFields,
      };
    }
    return {
      indexed: false,
      fileCount: 0,
      truncated: false,
      message: runningFields.running
        ? runningFields.progressMessage ?? 'Indexing in progress…'
        : 'No index yet. Click Reindex to build workspace context.',
      health,
      ...runningFields,
    };
  }
  return {
    indexed: true,
    fileCount: meta.fileCount ?? 0,
    truncated: Boolean(meta.truncated),
    lastIndexedAt: meta.generatedAt,
    message: runningFields.running
      ? runningFields.progressMessage ?? 'Indexing in progress…'
      : meta.lastEmbeddingError
        ? `Indexed with embedding issue: ${meta.lastEmbeddingError}`
        : health.overall === 'lexical_only'
          ? `Lexical ready (${meta.fileCount ?? 0} files); embeddings ${health.pipelines.embeddings.status}`
          : `Indexed ${meta.fileCount ?? 0} files`,
    sqlitePath: meta.sqlitePath,
    embeddingError: meta.lastEmbeddingError,
    health,
    ...runningFields,
  };
}

export async function reindexWorkspace(options: {
  workspaceRoot: string;
  maximumFiles?: number;
  concurrency?: number;
  semanticIndex?: SemanticIndexSettings;
  /** Full rebuild. Default false — fingerprint-aware incremental/unchanged. */
  force?: boolean;
  filePaths?: readonly string[];
  /**
   * When false, do not abort an in-flight index (FS incremental).
   * User Refresh/Rebuild keep the default (preempt current run).
   */
  preempt?: boolean;
  abortSignal?: AbortSignal;
  onProgress?: (progress: WorkspaceIndexProgress) => void;
  onLexicalReady?: (
    partial: Awaited<ReturnType<typeof runFullWorkspaceIndex>>,
  ) => void | Promise<void>;
}): Promise<{
  status: string;
  fileCount: number;
  truncated: boolean;
  message: string;
}> {
  // Replace any prior controller so pause always targets the latest run —
  // unless this is a non-preempting incremental refresh.
  if (options.preempt === false) {
    if (activeReindexAbort) {
      const status = getIndexStatus(options.workspaceRoot);
      return {
        status: 'skipped',
        fileCount: status.fileCount,
        truncated: status.truncated,
        message:
          status.progressMessage ??
          'Indexing already running — incremental refresh deferred.',
      };
    }
  } else {
    activeReindexAbort?.abort();
  }
  const controller = new AbortController();
  activeReindexAbort = controller;
  const mitiiDir = join(options.workspaceRoot, '.mitii');

  const onExternalAbort = (): void => {
    controller.abort();
  };
  if (options.abortSignal) {
    if (options.abortSignal.aborted) {
      controller.abort();
    } else {
      options.abortSignal.addEventListener('abort', onExternalAbort, {
        once: true,
      });
    }
  }

  try {
    const workspaceId = workspaceIdFromRoot(options.workspaceRoot);
    const logsDir = indexLogsDir(options.workspaceRoot);
    const scoped = Boolean(options.filePaths?.length);
    appendDesktopLog(logsDir, 'indexing', 'start', {
      mirrorRuns: true,
      extra: {
        force: options.force === true,
        scoped,
        pathCount: options.filePaths?.length ?? 0,
        maximumFiles: options.maximumFiles,
        semanticEnabled: options.semanticIndex?.enabled === true,
      },
    });

    const result = await runFullWorkspaceIndex({
      mitiiDir,
      workspaceRoot: options.workspaceRoot,
      workspaceId,
      maximumFiles: options.maximumFiles,
      concurrency: options.concurrency,
      semanticIndex: options.semanticIndex,
      force: options.force === true,
      ...(options.filePaths?.length ? { filePaths: options.filePaths } : {}),
      abortSignal: controller.signal,
      onProgress: (progress) => {
        options.onProgress?.({
          ...progress,
          percent:
            progress.percent ??
            estimateIndexProgressPercent(progress.stage),
        });
      },
      ...(options.onLexicalReady
        ? { onLexicalReady: options.onLexicalReady }
        : {}),
      openDatabase: ((
        filename: string,
        openOptions?: { readonly?: boolean; fileMustExist?: boolean },
      ) => {
        try {
          return new Database(filename, openOptions);
        } catch (error) {
          appendDesktopLog(logsDir, 'sqlite', `open_failed ${errorMessage(error)}`, {
            level: 'error',
            mirrorRuns: true,
            extra: { path: filename },
          });
          throw error;
        }
      }) as never,
    });

    // Record index meta on the Desktop-owned multi-repo store when available.
    const storePath = process.env.MITII_DESKTOP_STORE_PATH?.trim();
    if (
      storePath &&
      (result.status === 'indexed' || result.status === 'unchanged')
    ) {
      try {
        const store = openDesktopStore(storePath);
        try {
          store.setWorkspaceIndexMeta(options.workspaceRoot, {
            fileCount: result.fileCount,
            updatedAt: new Date().toISOString(),
          });
        } finally {
          store.close();
        }
      } catch (error) {
        appendDesktopLog(
          logsDir,
          'store',
          `index_meta_write_failed ${errorMessage(error)}`,
          {
            level: 'warn',
            extra: { storePath, workspaceRoot: options.workspaceRoot },
          },
        );
      }
    }

    const message =
      result.status === 'indexed'
        ? `Indexed ${result.fileCount} files`
        : result.status === 'unchanged'
          ? 'Index unchanged'
          : result.status === 'skipped'
            ? `Skipped${result.skipReason ? ` (${result.skipReason})` : ''}`
            : result.status === 'cancelled'
              ? 'Index paused'
              : `Index ${result.status}`;

    appendDesktopLog(logsDir, 'indexing', `finished ${result.status}`, {
      level: result.status === 'cancelled' ? 'warn' : 'info',
      mirrorRuns: true,
      extra: {
        fileCount: result.fileCount,
        truncated: result.truncated,
        message,
      },
    });

    return {
      status: result.status,
      fileCount: result.fileCount,
      truncated: result.truncated,
      message,
    };
  } catch (error) {
    const logsDir = indexLogsDir(options.workspaceRoot);
    if (error instanceof IndexLockedError) {
      const status = getIndexStatus(options.workspaceRoot);
      appendDesktopLog(logsDir, 'indexing', 'skipped_locked', {
        level: 'warn',
        mirrorRuns: true,
      });
      return {
        status: 'skipped',
        fileCount: status.fileCount,
        truncated: status.truncated,
        message:
          status.progressMessage ??
          'Indexing already running — watch the header icon for progress.',
      };
    }
    const message = errorMessage(error);
    if (controller.signal.aborted || /cancell?ed/i.test(message)) {
      appendDesktopLog(logsDir, 'indexing', 'cancelled', {
        level: 'warn',
        mirrorRuns: true,
      });
      return {
        status: 'cancelled',
        fileCount: 0,
        truncated: false,
        message: 'Index paused',
      };
    }
    appendDesktopLog(logsDir, 'indexing', `failed ${message}`, {
      level: 'error',
      mirrorRuns: true,
      extra: { workspaceRoot: options.workspaceRoot },
    });
    throw error;
  } finally {
    if (options.abortSignal) {
      options.abortSignal.removeEventListener('abort', onExternalAbort);
    }
    if (activeReindexAbort === controller) {
      activeReindexAbort = undefined;
    }
    if (!isIndexLockHeld(mitiiDir).held) {
      clearIndexProgress(mitiiDir);
    }
  }
}
