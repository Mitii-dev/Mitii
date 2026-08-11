import { join } from 'node:path';

import {
  runFullWorkspaceIndex as runSharedFullWorkspaceIndex,
  type FullWorkspaceIndexResult,
  type SemanticIndexSettings,
} from '@mitii/host';
import Database from 'better-sqlite3';

export type { FullWorkspaceIndexResult };

export async function runFullWorkspaceIndex(options: {
  cwd: string;
  workspaceId: string;
  maximumFiles?: number;
  semanticIndex?: SemanticIndexSettings;
  force?: boolean;
  filePaths?: readonly string[];
}): Promise<FullWorkspaceIndexResult> {
  return runSharedFullWorkspaceIndex({
    mitiiDir: join(options.cwd, '.mitii'),
    workspaceRoot: options.cwd,
    workspaceId: options.workspaceId,
    maximumFiles: options.maximumFiles,
    semanticIndex: options.semanticIndex,
    force: options.force,
    filePaths: options.filePaths,
    openDatabase: ((
      filename: string,
      openOptions?: { readonly?: boolean; fileMustExist?: boolean },
    ) => new Database(filename, openOptions)) as never,
  });
}
