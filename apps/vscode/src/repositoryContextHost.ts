import {
  createHostRepositoryContext as createSharedHostRepositoryContext,
  type HostEditorContextReferences,
  type SemanticIndexSettings,
} from '@mitii/host';
import type {
  RepositoryContextPipeline,
  RepositoryStatePipeline,
  GitPort,
} from '@mitii/v8';

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
}): RepositoryContextPipeline {
  return createSharedHostRepositoryContext({
    ...options,
    openDatabase: openSqliteDatabase as never,
  });
}
