import {
  createHostRepositoryContext as createSharedHostRepositoryContext,
  type SemanticIndexSettings,
} from '@mitii/host';
import type {
  RepositoryContextPipeline,
  RepositoryStatePipeline,
} from '@mitii/v8';

import { openSqliteDatabase } from './nativeSqlite.js';

export function createHostRepositoryContext(options: {
  repositoryState: RepositoryStatePipeline;
  workspaceRoot: string;
  textIndexDatabasePath?: string;
  semanticIndex?: SemanticIndexSettings;
}): RepositoryContextPipeline {
  return createSharedHostRepositoryContext({
    ...options,
    openDatabase: openSqliteDatabase as never,
  });
}
