import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import * as vscode from 'vscode';

import type { MitiiClient } from '@mitii/sdk';
import {
  createDebouncedIncrementalIndexTrigger,
  IndexLockedError,
  resolveMaximumIndexFiles,
} from '@mitii/host';
import { isSecurityConcern, WorkspaceIgnorePolicy } from '@mitii/sdk';

import { runFullWorkspaceIndex } from '../fullWorkspaceIndex.js';
import { scaffoldMitiiWorkspace } from '../mitiiWorkspace.js';
import type { IndexStatusSnapshot } from '../protocol.js';
import { rehydrateRepositoryStateFromDisk } from '../rehydrateRepositoryState.js';
import { resolveVsCodeSemanticIndexSettings } from '../semanticIndex.js';
import type { MitiiSidebarProvider } from '../sidebar.js';
import { buildWorkspaceSnapshot } from '../workspaceSnapshot.js';
import type { ActivationRuntime } from './runtime.js';

/** Full-workspace index command with progress UI; prefers the sidebar publisher. */
export function createIndexWorkspace(
  rt: ActivationRuntime,
): () => Promise<IndexStatusSnapshot> {
  const { context, channel } = rt;
  const workspaceRoot = (): string | undefined => rt.workspaceRoot();
  const ensureClient = (): Promise<MitiiClient> => rt.ensureClient();
  const sidebar = (): MitiiSidebarProvider | undefined => rt.sidebar;

  const indexWorkspace = async (): Promise<IndexStatusSnapshot> => {
    const root =
      vscode.workspace
        .getConfiguration('mitii')
        .get<string>('workspace.rootPathOverride')
        ?.trim() || workspaceRoot();
    if (!root) {
      void vscode.window.showWarningMessage('Open a folder to index.');
      return {
        fileCount: 0,
        truncated: false,
        message: 'Open a workspace folder to index',
      };
    }

    rt.indexAbort?.abort();
    rt.indexAbort = new AbortController();
    const abortSignal = rt.indexAbort.signal;

    return vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: 'Mitii: Indexing workspace',
        cancellable: true,
      },
      async (progress, token) => {
        token.onCancellationRequested(() => rt.indexAbort?.abort());
        const onProgress = (event: {
          message: string;
          fileCount?: number;
        }) => {
          progress.report({
            message: event.fileCount
              ? `${event.message} (${event.fileCount} files)`
              : event.message,
          });
          channel.appendLine(`[index] ${event.message}`);
        };

        const activeSidebar = sidebar();
        if (activeSidebar) {
          const status = await activeSidebar.publishIndexSnapshot({
            force: true,
            abortSignal,
            onProgress,
          });
          if (!abortSignal.aborted) {
            void vscode.window.showInformationMessage(
              status.message ?? 'Mitii index updated.',
            );
          }
          return status;
        }
        const c = await ensureClient();
        const dir = join(root, '.mitii');
        mkdirSync(dir, { recursive: true });
        let fileCount = 0;
        let truncated = false;
        let indexMode: IndexStatusSnapshot['indexMode'] = 'full';
        let fallbackReason: string | undefined;
        let published;
        try {
          const full = await runFullWorkspaceIndex({
            mitiiDir: dir,
            workspaceRoot: root,
            workspaceId: rt.workspaceId(),
            force: true,
            abortSignal,
            onProgress,
            semanticIndex: await resolveVsCodeSemanticIndexSettings(
              vscode,
              context.secrets,
            ),
          });
          fileCount = full.fileCount;
          truncated = full.truncated;
          if (full.status === 'cancelled') {
            return {
              fileCount,
              truncated,
              message: 'Indexing cancelled',
            };
          }
          if (full.status === 'skipped') {
            await rehydrateRepositoryStateFromDisk({
              client: c,
              mitiiDir: dir,
              workspaceRoot: root,
              workspaceId: rt.workspaceId(),
              channel,
            });
            return {
              fileCount,
              truncated,
              message: 'Indexing already in progress',
            };
          }
          published = await c.publishRepositoryStateFromIndexing(full.indexing, {
            catalogRevisionByRoot: full.catalogRevisionByRoot,
            graphRevisionByRoot: full.graphRevisionByRoot,
            mapRevisionByRoot: full.mapRevisionByRoot,
          });
          if (full.status === 'unchanged') {
            channel.appendLine(
              `[index] unchanged (up to date) at ${full.databasePath}; vector=${full.vectorIndex.status}${full.vectorIndex.profileId ? ` profile=${full.vectorIndex.profileId}` : ''}`,
            );
          } else {
            channel.appendLine(
              `[index] full code/text/graph/map index stored at ${full.databasePath}; vector=${full.vectorIndex.status}${full.vectorIndex.profileId ? ` profile=${full.vectorIndex.profileId}` : ''}${full.vectorIndex.reason ? ` reason=${full.vectorIndex.reason}` : ''}`,
            );
          }
        } catch (error) {
          if (
            error instanceof IndexLockedError ||
            (error instanceof Error && error.name === 'IndexLockedError')
          ) {
            channel.appendLine(
              `[index] skipped (lock held): ${
                error instanceof Error ? error.message : String(error)
              }`,
            );
            await rehydrateRepositoryStateFromDisk({
              client: c,
              mitiiDir: dir,
              workspaceRoot: root,
              workspaceId: rt.workspaceId(),
              channel,
            });
            return {
              fileCount,
              truncated,
              message: 'Indexing already in progress',
            };
          }
          indexMode = 'host_snapshot';
          fallbackReason = error instanceof Error ? error.message : String(error);
          channel.appendLine(
            `[index] full index unavailable; falling back to host snapshot: ${fallbackReason}`,
          );
          const snapshot = await buildWorkspaceSnapshot({
            workspaceRoot: root,
            workspaceId: rt.workspaceId(),
            maxFiles: resolveMaximumIndexFiles(
              vscode.workspace
                .getConfiguration('mitii')
                .get<number>('workspace.maximumIndexFiles'),
            ),
          });
          fileCount = snapshot.fileCount;
          truncated = snapshot.truncated;
          published = await c.publishRepositoryState(snapshot.candidate);
        }
        if (published.status === 'published') {
          writeFileSync(
            join(dir, 'last-repository-state.json'),
            `${JSON.stringify(
              {
                ...published.descriptor,
                fileCount,
                truncated,
                indexMode,
              },
              null,
              2,
            )}\n`,
          );
          channel.appendLine(
            `[index] readiness=${published.descriptor.readiness} token=${published.reference.stateToken.slice(0, 16)}… files=${fileCount}`,
          );
        }
        const status: IndexStatusSnapshot = {
          fileCount,
          truncated,
          message:
            indexMode === 'host_snapshot'
              ? `Indexed ${fileCount} files (host snapshot fallback)`
              : `Indexed ${fileCount} files`,
        };
        void vscode.window.showInformationMessage(
          status.message ?? 'Mitii index updated.',
        );
        return status;
      },
    );
  };

  return indexWorkspace;
}

/** Incremental re-index on save, FS changes, and workspace-folder changes. */
export function registerIndexingListeners(
  rt: ActivationRuntime,
  sidebar: MitiiSidebarProvider,
): vscode.Disposable[] {
  const { channel } = rt;
  const workspaceRoot = (): string | undefined => rt.workspaceRoot();
  const invalidateClient = (): void => rt.invalidateClient();
  const ignorePolicy = new WorkspaceIgnorePolicy();

  const relativeWorkspacePath = (uri: vscode.Uri): string | undefined => {
    const root = workspaceRoot();
    if (!root || uri.scheme !== 'file') return undefined;
    const relative = vscode.workspace.asRelativePath(uri, false);
    if (!relative || relative === uri.fsPath) return undefined;
    return relative.replace(/\\/g, '/');
  };

  const shouldIndexRelative = (relativePath: string, fsPath: string): boolean => {
    if (isSecurityConcern(relativePath)) return false;
    return !ignorePolicy.shouldIgnore({
      root: workspaceRoot() ?? '',
      path: fsPath,
      relativePath,
      kind: 'file',
      depth: relativePath.split('/').length,
    });
  };

  let trigger: ReturnType<typeof createDebouncedIncrementalIndexTrigger> | undefined;
  const ensureTrigger = ():
    | ReturnType<typeof createDebouncedIncrementalIndexTrigger>
    | undefined => {
    const root = workspaceRoot();
    if (!root) {
      trigger?.dispose();
      trigger = undefined;
      return undefined;
    }
    if (trigger) return trigger;
    trigger = createDebouncedIncrementalIndexTrigger({
      workspaceRoot: root,
      onFlush: async (filePaths) => {
        const status = await sidebar.publishIndexSnapshot({
          filePaths: [...filePaths],
        });
        sidebar.post({ type: 'index.status', index: status });
        channel.appendLine(
          `[index] refresh ${filePaths.join(', ')} ${status.message ?? 'updated'}`,
        );
      },
      onError: (error) => {
        channel.appendLine(
          `[index] refresh failed: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      },
    });
    return trigger;
  };

  const queueRelative = (relativePath: string | undefined, fsPath: string): void => {
    if (!relativePath) return;
    if (!shouldIndexRelative(relativePath, fsPath)) return;
    ensureTrigger()?.notify([relativePath]);
  };

  const watcher = vscode.workspace.createFileSystemWatcher('**/*');

  return [
    vscode.workspace.onDidSaveTextDocument((document) => {
      queueRelative(relativeWorkspacePath(document.uri), document.uri.fsPath);
    }),
    watcher.onDidCreate((uri) => {
      queueRelative(relativeWorkspacePath(uri), uri.fsPath);
    }),
    watcher.onDidChange((uri) => {
      queueRelative(relativeWorkspacePath(uri), uri.fsPath);
    }),
    watcher.onDidDelete((uri) => {
      queueRelative(relativeWorkspacePath(uri), uri.fsPath);
    }),
    watcher,
    {
      dispose() {
        trigger?.dispose();
        trigger = undefined;
      },
    },
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
      trigger?.dispose();
      trigger = undefined;
      const root = workspaceRoot();
      invalidateClient();
      if (!root) return;
      try {
        channel.appendLine(
          `[mitii] workspace data: ${scaffoldMitiiWorkspace(root)}`,
        );
      } catch (error) {
        channel.appendLine(
          `[mitii] scaffold failed: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
      void sidebar.ensureIndexed().then((status) => {
        sidebar.post({ type: 'index.status', index: status });
        channel.appendLine(
          `[index] workspace-folder change ${status.message ?? 'ready'}`,
        );
      });
    }),
  ];
}

export function registerIndexingCommands(
  rt: ActivationRuntime,
  indexWorkspace: () => Promise<IndexStatusSnapshot>,
): vscode.Disposable[] {
  const { channel } = rt;
  return [
    vscode.commands.registerCommand('mitii.indexWorkspace', async () => {
      await indexWorkspace();
    }),
    vscode.commands.registerCommand('mitii.pauseIndexing', () => {
      rt.indexAbort?.abort();
      channel.appendLine('[index] pause requested');
      void vscode.window.showInformationMessage('Mitii indexing paused.');
    }),
  ];
}
