import {
  resolveMaximumIndexFiles,
  runFullWorkspaceIndex as runSharedFullWorkspaceIndex,
  type FullWorkspaceIndexResult,
  type SemanticIndexSettings,
} from '@mitii/host';
import * as vscode from 'vscode';

import { openSqliteDatabase } from './nativeSqlite.js';

export type { FullWorkspaceIndexResult };

export async function runFullWorkspaceIndex(options: {
  mitiiDir: string;
  workspaceRoot: string;
  workspaceId: string;
  maximumFiles?: number;
  semanticIndex?: SemanticIndexSettings;
  force?: boolean;
  filePaths?: readonly string[];
  abortSignal?: AbortSignal;
  onProgress?: Parameters<typeof runSharedFullWorkspaceIndex>[0]['onProgress'];
}): Promise<FullWorkspaceIndexResult> {
  const configured = vscode.workspace
    .getConfiguration('mitii')
    .get<number>('workspace.maximumIndexFiles');
  return runSharedFullWorkspaceIndex({
    ...options,
    maximumFiles: resolveMaximumIndexFiles(
      options.maximumFiles ?? configured,
    ),
    openDatabase: openSqliteDatabase as never,
  });
}
