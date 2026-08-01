import {
  runFullWorkspaceIndex as runSharedFullWorkspaceIndex,
  type FullWorkspaceIndexResult,
  type SemanticIndexSettings,
} from '@mitii/host';

import { openSqliteDatabase } from './nativeSqlite.js';

export type { FullWorkspaceIndexResult };

export async function runFullWorkspaceIndex(options: {
  mitiiDir: string;
  workspaceRoot: string;
  workspaceId: string;
  maximumFiles?: number;
  semanticIndex?: SemanticIndexSettings;
}): Promise<FullWorkspaceIndexResult> {
  return runSharedFullWorkspaceIndex({
    ...options,
    openDatabase: openSqliteDatabase as never,
  });
}
