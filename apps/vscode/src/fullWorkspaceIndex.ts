import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

import Database from 'better-sqlite3';
import {
  WorkspaceIndexingAdapterFactory,
  type WorkspaceIndexingPipelineResult,
} from '@mitii/v8';

const INDEX_DB_FILE = 'repository-index.sqlite';
const DEFAULT_MAXIMUM_FILES = 2_000;

export interface FullWorkspaceIndexResult {
  indexing: WorkspaceIndexingPipelineResult;
  fileCount: number;
  truncated: boolean;
  databasePath: string;
}

export async function runFullWorkspaceIndex(options: {
  mitiiDir: string;
  workspaceRoot: string;
  workspaceId: string;
  maximumFiles?: number;
}): Promise<FullWorkspaceIndexResult> {
  mkdirSync(options.mitiiDir, { recursive: true });

  const databasePath = join(options.mitiiDir, INDEX_DB_FILE);
  const database = new Database(databasePath);
  try {
    database.pragma('journal_mode = WAL');
    database.pragma('foreign_keys = ON');

    const components = await new WorkspaceIndexingAdapterFactory().create({
      codeIndexDatabase: database,
      textIndexDatabase: database,
    });

    const maximumFiles = options.maximumFiles ?? DEFAULT_MAXIMUM_FILES;
    const snapshot = await components.scanner.scan({
      roots: [options.workspaceRoot],
      maximumFiles,
    });

    const indexing = await components.pipeline.execute({
      workspace: options.workspaceId,
      snapshot,
      indexedAt: Date.now(),
      maximumFiles,
      maximumReportedFileResults: maximumFiles,
      synchronizeEmbeddings: components.synchronizeEmbeddings,
    });

    return {
      indexing,
      fileCount: snapshot.statistics.files,
      truncated: snapshot.status !== 'complete',
      databasePath,
    };
  } finally {
    database.close();
  }
}
