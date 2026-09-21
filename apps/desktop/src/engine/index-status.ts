/**
 * Index status + reindex for Desktop engine.
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';

import {
  readIndexRuntimeMetadata,
  runFullWorkspaceIndex,
  type SemanticIndexSettings,
} from '@mitii/host';
import Database from 'better-sqlite3';

import { workspaceIdFromRoot } from './workspace-id.js';
import { openDesktopStore } from './desktop-store.js';

export interface DesktopIndexStatus {
  indexed: boolean;
  fileCount: number;
  truncated: boolean;
  lastIndexedAt?: string;
  message: string;
  sqlitePath?: string;
  embeddingError?: string;
}

export function getIndexStatus(workspaceRoot: string): DesktopIndexStatus {
  const mitiiDir = join(workspaceRoot, '.mitii');
  const metaPath = join(mitiiDir, 'index-runtime.json');
  const meta = readIndexRuntimeMetadata(metaPath);
  if (!meta) {
    const sqliteFallback = join(mitiiDir, 'repository-index.sqlite');
    if (existsSync(sqliteFallback)) {
      return {
        indexed: true,
        fileCount: 0,
        truncated: false,
        message:
          'Index database present (metadata missing). Reindex recommended.',
        sqlitePath: sqliteFallback,
      };
    }
    return {
      indexed: false,
      fileCount: 0,
      truncated: false,
      message: 'No index yet. Click Reindex to build workspace context.',
    };
  }
  return {
    indexed: true,
    fileCount: meta.fileCount ?? 0,
    truncated: Boolean(meta.truncated),
    lastIndexedAt: meta.generatedAt,
    message: meta.lastEmbeddingError
      ? `Indexed with embedding issue: ${meta.lastEmbeddingError}`
      : `Indexed ${meta.fileCount ?? 0} files`,
    sqlitePath: meta.sqlitePath,
    embeddingError: meta.lastEmbeddingError,
  };
}

export async function reindexWorkspace(options: {
  workspaceRoot: string;
  maximumFiles?: number;
  semanticIndex?: SemanticIndexSettings;
  force?: boolean;
}): Promise<{
  status: string;
  fileCount: number;
  truncated: boolean;
  message: string;
}> {
  const workspaceId = workspaceIdFromRoot(options.workspaceRoot);
  const result = await runFullWorkspaceIndex({
    mitiiDir: join(options.workspaceRoot, '.mitii'),
    workspaceRoot: options.workspaceRoot,
    workspaceId,
    maximumFiles: options.maximumFiles,
    semanticIndex: options.semanticIndex,
    force: options.force ?? true,
    openDatabase: ((
      filename: string,
      openOptions?: { readonly?: boolean; fileMustExist?: boolean },
    ) => new Database(filename, openOptions)) as never,
  });

  // Record index meta on the Desktop-owned multi-repo store when available.
  const storePath = process.env.MITII_DESKTOP_STORE_PATH?.trim();
  if (storePath && (result.status === 'indexed' || result.status === 'unchanged')) {
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
    } catch {
      /* non-fatal */
    }
  }

  return {
    status: result.status,
    fileCount: result.fileCount,
    truncated: result.truncated,
    message:
      result.status === 'indexed'
        ? `Indexed ${result.fileCount} files`
        : result.status === 'unchanged'
          ? 'Index unchanged'
          : result.status === 'skipped'
            ? `Skipped${result.skipReason ? ` (${result.skipReason})` : ''}`
            : `Index ${result.status}`,
  };
}
