import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { MitiiClient } from '@mitii/sdk';
import { resolveMaximumIndexFiles } from '@mitii/host';
import type * as vscode from 'vscode';

import { runFullWorkspaceIndex } from './fullWorkspaceIndex.js';
import { scaffoldMitiiWorkspace } from './mitiiWorkspace.js';
import { rehydrateRepositoryStateFromDisk } from './rehydrateRepositoryState.js';
import { resolveVsCodeSemanticIndexSettings } from './semanticIndex.js';
import { buildWorkspaceSnapshot } from './workspaceSnapshot.js';

type IndexChannel = { appendLine(line: string): void };

/** Publish a full workspace index, falling back to a host snapshot. */
export async function autoPublishFullOrSnapshot(options: {
  client: MitiiClient;
  mitiiDir: string;
  workspaceRoot: string;
  workspaceId: string;
  channel: IndexChannel;
  vs: typeof vscode;
  secrets?: vscode.SecretStorage;
}): Promise<void> {
  try {
    const full = await runFullWorkspaceIndex({
      mitiiDir: options.mitiiDir,
      workspaceRoot: options.workspaceRoot,
      workspaceId: options.workspaceId,
      ...(options.secrets
        ? {
            semanticIndex: await resolveVsCodeSemanticIndexSettings(
              options.vs,
              options.secrets,
            ),
          }
        : {}),
    });
    await options.client.publishRepositoryStateFromIndexing(full.indexing, {
      catalogRevisionByRoot: full.catalogRevisionByRoot,
      graphRevisionByRoot: full.graphRevisionByRoot,
      mapRevisionByRoot: full.mapRevisionByRoot,
    });
    options.channel.appendLine(
      `[index] auto-published full index (${full.fileCount} files); vector=${full.vectorIndex.status}${full.vectorIndex.reason ? ` reason=${full.vectorIndex.reason}` : ''}`,
    );
  } catch (fullIndexError) {
    const snap = await buildWorkspaceSnapshot({
      workspaceRoot: options.workspaceRoot,
      workspaceId: options.workspaceId,
      maxFiles: resolveMaximumIndexFiles(
        options.vs.workspace
          .getConfiguration('mitii')
          .get<number>('workspace.maximumIndexFiles'),
      ),
    });
    await options.client.publishRepositoryState(snap.candidate);
    options.channel.appendLine(
      `[index] auto-published host snapshot (${snap.fileCount} files; full index unavailable: ${
        fullIndexError instanceof Error
          ? fullIndexError.message
          : String(fullIndexError)
      })`,
    );
  }
}

/**
 * Ensure repository state exists so context/tool routes can pin. Rehydrates
 * from an on-disk index when possible, otherwise publishes a fresh index.
 * Never throws; failures are logged to the channel.
 */
export async function ensureRepositoryStateForAsk(options: {
  client: MitiiClient;
  workspaceRoot: string | undefined;
  workspaceId?: string;
  channel: vscode.OutputChannel;
  vs: typeof vscode;
  secrets?: vscode.SecretStorage;
}): Promise<void> {
  const { client, workspaceRoot, channel, vs } = options;
  if (!workspaceRoot) return;
  try {
    const workspaceId = options.workspaceId ?? 'vscode_workspace';
    const latest = await client.getLatestRepositoryState(workspaceId);
    if (latest) return;
    const mitiiDir = scaffoldMitiiWorkspace(workspaceRoot);
    const sqlitePath = join(mitiiDir, 'repository-index.sqlite');
    const publish = () =>
      autoPublishFullOrSnapshot({
        client,
        mitiiDir,
        workspaceRoot,
        workspaceId,
        channel,
        vs,
        secrets: options.secrets,
      });
    if (!existsSync(sqlitePath)) {
      await publish();
      return;
    }
    const rehydrated = await rehydrateRepositoryStateFromDisk({
      client,
      mitiiDir,
      workspaceRoot,
      workspaceId,
      channel,
    });
    if (rehydrated.ok) {
      // In-memory state restored from disk; skip full reindex.
      return;
    }
    channel.appendLine(
      `[index] on-disk sqlite present but rehydrate failed; falling through to full index`,
    );
    await publish();
  } catch (error) {
    channel.appendLine(
      `[index] auto-publish skipped: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
