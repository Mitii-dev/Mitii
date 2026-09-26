import {
  resolveIndexConcurrency,
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
  concurrency?: number;
  semanticIndex?: SemanticIndexSettings;
  force?: boolean;
  filePaths?: readonly string[];
  abortSignal?: AbortSignal;
  onProgress?: Parameters<typeof runSharedFullWorkspaceIndex>[0]['onProgress'];
  onLexicalReady?: Parameters<
    typeof runSharedFullWorkspaceIndex
  >[0]['onLexicalReady'];
}): Promise<FullWorkspaceIndexResult> {
  const configured = vscode.workspace
    .getConfiguration('mitii')
    .get<number>('workspace.maximumIndexFiles');
  const configuredConcurrency = vscode.workspace
    .getConfiguration('mitii')
    .get<number>('workspace.indexConcurrency');
  return runSharedFullWorkspaceIndex({
    ...options,
    maximumFiles: resolveMaximumIndexFiles(
      options.maximumFiles ?? configured,
    ),
    concurrency: resolveIndexConcurrency(
      options.concurrency ?? configuredConcurrency,
    ),
    openDatabase: openSqliteDatabase as never,
  });
}
