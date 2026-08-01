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
}): Promise<FullWorkspaceIndexResult> {
  return runSharedFullWorkspaceIndex({
    mitiiDir: join(options.cwd, '.mitii'),
    workspaceRoot: options.cwd,
    workspaceId: options.workspaceId,
    maximumFiles: options.maximumFiles,
    semanticIndex: options.semanticIndex,
    openDatabase: ((
      filename: string,
      openOptions?: { readonly?: boolean; fileMustExist?: boolean },
    ) => new Database(filename, openOptions)) as never,
  });
}
