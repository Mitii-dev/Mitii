import {
  createHostRepositoryContext as createSharedHostRepositoryContext,
  type HostEditorContextReferences,
  type SemanticIndexSettings,
} from '@mitii/host';
import type {
  RepositoryContextPipeline,
  RepositoryStatePipeline,
  GitPort,
} from '@mitii/sdk';

import { openSqliteDatabase } from './nativeSqlite.js';

export function createHostRepositoryContext(options: {
  repositoryState: RepositoryStatePipeline;
  workspaceRoot: string;
  textIndexDatabasePath?: string;
  semanticIndex?: SemanticIndexSettings;
  git?: GitPort;
  resolveEditorReferences?: () =>
    | HostEditorContextReferences
    | Promise<HostEditorContextReferences>;
  injection?: {
    repoMapChars?: number;
    repoMapFilesMax?: number;
    sketchChars?: number;
    sketchItemsMax?: number;
  };
}): RepositoryContextPipeline {
  return createSharedHostRepositoryContext({
    ...options,
    openDatabase: openSqliteDatabase as never,
  });
}
