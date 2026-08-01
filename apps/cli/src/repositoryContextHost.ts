import {
  createHostRepositoryContext as createSharedHostRepositoryContext,
  type SemanticIndexSettings,
} from '@mitii/host';
import type {
  RepositoryContextPipeline,
  RepositoryStatePipeline,
} from '@mitii/v8';
import Database from 'better-sqlite3';

export function createHostRepositoryContext(options: {
  repositoryState: RepositoryStatePipeline;
  workspaceRoot: string;
  textIndexDatabasePath?: string;
  semanticIndex?: SemanticIndexSettings;
}): RepositoryContextPipeline {
  return createSharedHostRepositoryContext({
    ...options,
    openDatabase: ((
      filename: string,
      openOptions?: { readonly?: boolean; fileMustExist?: boolean },
    ) => new Database(filename, openOptions)) as never,
  });
}
