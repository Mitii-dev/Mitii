import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { IndexLockedError, readIndexPipelineHealth } from '@mitii/host';

import { runFullWorkspaceIndex } from '../fullWorkspaceIndex.js';
import { scaffoldMitiiWorkspace } from '../mitiiWorkspace.js';
import type { IndexStatusSnapshot } from '../protocol.js';
import { rehydrateRepositoryStateFromDisk } from '../rehydrateRepositoryState.js';
import { resolveVsCodeSemanticIndexSettings } from '../semanticIndex.js';
import { buildWorkspaceSnapshot } from '../workspaceSnapshot.js';
import { readMaximumIndexFiles } from './configValues.js';
import type { SidebarContext } from './context.js';
import {
  indexStatusFromDescriptor,
  needsFullIndexRefresh,
  type PersistedIndexState,
  type RepositoryDescriptorSnapshot,
} from './indexDescriptor.js';

/**
 * Repository index status owner: cached/persisted status reads, background
 * ensure-indexed, and full/incremental snapshot publication.
 */
export class SidebarIndexOrchestrator {
  lastIndex: IndexStatusSnapshot = {
    fileCount: 0,
    truncated: false,
    message: 'Not indexed yet',
  };
  private ensureIndexedPromise?: Promise<IndexStatusSnapshot>;

  constructor(private readonly ctx: SidebarContext) {}

  async readIndexStatusPublic(): Promise<IndexStatusSnapshot> {
    return this.withEmbedding(await this.readIndexStatus());
  }

  /** Post the latest cached status (with embedding info) to the webview. */
  async postRefreshedStatus(): Promise<void> {
    this.ctx.post({
      type: 'index.status',
      index: await this.withEmbedding(await this.readIndexStatus()),
    });
  }

  /** Explicit reindex requested from the webview. */
  async reindex(): Promise<void> {
    this.postIndexingStatus('Indexing workspace…');
    const index = await this.withEmbedding(await this.ctx.onIndexWorkspace());
    this.lastIndex = index;
    this.ctx.post({ type: 'index.status', index });
  }



  /**
   * Rehydrate in-memory repository state after Extension Host / client restart.
   * Disk cache alone is not enough — publish uses InMemoryRepositoryStateStore.
   */
  async ensureIndexed(): Promise<IndexStatusSnapshot> {
    if (this.ensureIndexedPromise) {
      return this.ensureIndexedPromise;
    }
    this.ensureIndexedPromise = this.ensureIndexedInner();
    try {
      return await this.ensureIndexedPromise;
    } finally {
      this.ensureIndexedPromise = undefined;
    }
  }

  startBackgroundIndex(reason: string): void {
    const root = this.ctx.effectiveRoot();
    if (!root) {
      this.ctx.post({
        type: 'index.status',
        index: {
          fileCount: 0,
          truncated: false,
          message: 'Open a workspace folder to index',
        },
      });
      return;
    }
    // Activation already ensureIndexed; skip a redundant full path when caps are ready.
    if (
      reason === 'initial load' &&
      this.lastIndex.fileCount > 0 &&
      this.lastIndex.readiness === 'ready' &&
      !needsFullIndexRefresh(this.lastIndex)
    ) {
      void this.withEmbedding(this.lastIndex).then((index) => {
        this.lastIndex = index;
        this.ctx.post({ type: 'index.status', index });
        this.ctx.channel.appendLine(
          `[index] ${reason} skipped (already ready) files=${index.fileCount}`,
        );
      });
      return;
    }
    this.postIndexingStatus('Checking repository index…');
    void this.ensureIndexed()
      .then(async (index) => {
        this.lastIndex = await this.withEmbedding(index);
        this.ctx.post({ type: 'index.status', index: this.lastIndex });
        this.ctx.channel.appendLine(
          `[index] ${reason} ${index.message ?? 'ready'} files=${index.fileCount}`,
        );
      })
      .catch((error) => {
        const message =
          error instanceof Error ? error.message : String(error);
        this.lastIndex = {
          ...this.lastIndex,
          readiness: 'unavailable',
          message: `Index failed: ${message}`,
        };
        this.ctx.post({ type: 'index.status', index: this.lastIndex });
        this.ctx.channel.appendLine(`[index] ${reason} failed: ${message}`);
      });
  }

  postIndexingStatus(message: string): void {
    this.lastIndex = {
      ...this.lastIndex,
      message,
      readiness: 'indexing',
      discoveredFileCount: undefined,
      progressStage: undefined,
    };
    this.ctx.post({ type: 'index.status', index: this.lastIndex });
  }

  private async ensureIndexedInner(): Promise<IndexStatusSnapshot> {
    const root = this.ctx.effectiveRoot();
    if (!root) {
      this.lastIndex = {
        fileCount: 0,
        truncated: false,
        message: 'Open a workspace folder to index',
      };
      return this.lastIndex;
    }

    try {
      const client = await this.ctx.ensureClient();
      const latest = await client.getLatestRepositoryState(this.ctx.getWorkspaceId());
      if (latest) {
        if (this.lastIndex.fileCount === 0) {
          await this.readIndexStatus();
        }
        const descriptorStatus = indexStatusFromDescriptor(latest);
        this.lastIndex = {
          ...this.lastIndex,
          ...descriptorStatus,
          message:
            this.lastIndex.fileCount > 0
              ? `Indexed ${this.lastIndex.fileCount} files`
              : (this.lastIndex.message ?? 'Repository state ready'),
        };
        if (needsFullIndexRefresh(this.lastIndex)) {
          this.ctx.channel.appendLine(
            '[index] cached state is missing full code/text/graph/map index; republishing full index…',
          );
          return await this.publishIndexSnapshot();
        }
        return this.lastIndex;
      }

      // After client invalidate / restart, restore in-memory publish from disk
      // before paying for a full scan + lock (profile switches used to thrash here).
      const mitiiDir = scaffoldMitiiWorkspace(root);
      const rehydrated = await rehydrateRepositoryStateFromDisk({
        client,
        mitiiDir,
        workspaceRoot: root,
        workspaceId: this.ctx.getWorkspaceId(),
        channel: this.ctx.channel,
      });
      if (rehydrated.ok) {
        await this.readIndexStatus();
        const after = await client.getLatestRepositoryState(this.ctx.getWorkspaceId());
        if (after) {
          const descriptorStatus = indexStatusFromDescriptor(after);
          this.lastIndex = {
            ...this.lastIndex,
            ...descriptorStatus,
            fileCount: Math.max(this.lastIndex.fileCount, rehydrated.fileCount),
            ...(rehydrated.indexMode
              ? { indexMode: rehydrated.indexMode }
              : {}),
            message: `Indexed ${Math.max(this.lastIndex.fileCount, rehydrated.fileCount)} files`,
          };
          if (!needsFullIndexRefresh(this.lastIndex)) {
            return this.lastIndex;
          }
          this.ctx.channel.appendLine(
            '[index] rehydrated state still missing full caps; republishing full index…',
          );
        }
      }
    } catch (error) {
      this.ctx.channel.appendLine(
        `[index] latest-state check failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }

    this.ctx.channel.appendLine('[index] first load: publishing repository index…');
    this.postIndexingStatus('Indexing workspace…');
    const status = await this.publishIndexSnapshot();
    this.ctx.channel.appendLine(
      `[index] first-load ${status.message ?? 'done'} readiness=${status.readiness ?? 'n/a'}`,
    );
    return status;
  }

  async withEmbedding(
    index: IndexStatusSnapshot,
  ): Promise<IndexStatusSnapshot> {
    try {
      const semantic = await resolveVsCodeSemanticIndexSettings(
        this.ctx.vs,
        this.ctx.secrets,
      );
      const root = this.ctx.effectiveRoot();
      const health = root
        ? readIndexPipelineHealth({ workspaceRoot: root })
        : undefined;
      return {
        ...index,
        embeddingSource: semantic.source ?? (semantic.enabled ? 'bundled' : 'disabled'),
        embeddingModel: semantic.model,
        embeddingEnabled: semantic.enabled,
        ...(health
          ? {
              pipelineHealth: {
                overall: health.overall,
                running: health.running,
                pipelines: health.pipelines,
                native: health.native,
                ...(health.lastError ? { lastError: health.lastError } : {}),
              },
            }
          : {}),
      };
    } catch {
      return index;
    }
  }

  async readIndexStatus(): Promise<IndexStatusSnapshot> {
    const maximumIndexFiles = readMaximumIndexFiles(this.ctx.vs);
    const root = this.ctx.effectiveRoot();
    if (!root) {
      return {
        fileCount: 0,
        truncated: false,
        maximumIndexFiles,
        message: 'Open a workspace folder to index',
      };
    }
    if (this.lastIndex.fileCount > 0 && this.lastIndex.readiness) {
      return { ...this.lastIndex, maximumIndexFiles };
    }
    const cached = join(root, '.mitii', 'last-repository-state.json');
    if (existsSync(cached)) {
      try {
        const raw = JSON.parse(readFileSync(cached, 'utf8')) as
          Partial<PersistedIndexState> & {
          fileCount?: number;
          truncated?: boolean;
          reasons?: Array<{ message?: string }>;
        };
        const reasons: Array<{ message?: string }> | undefined = raw.reasons;
        const fromReason = reasons
          ?.map((r) => r.message?.match(/(\d+)\s+files?/i)?.[1])
          .find(Boolean);
        const fileCount =
          typeof raw.fileCount === 'number'
            ? raw.fileCount
            : fromReason
              ? Number(fromReason)
              : this.lastIndex.fileCount;
        const truncated =
          typeof raw.truncated === 'boolean'
            ? raw.truncated
            : this.lastIndex.truncated;
        const descriptorStatus =
          typeof raw.workspaceId === 'string' &&
          typeof raw.stateToken === 'string' &&
          Array.isArray(raw.roots)
            ? indexStatusFromDescriptor(raw as RepositoryDescriptorSnapshot)
            : {};
        this.lastIndex = {
          fileCount,
          truncated,
          maximumIndexFiles,
          ...descriptorStatus,
          indexMode: raw.indexMode ?? this.lastIndex.indexMode,
          message:
            fileCount > 0
              ? `Loaded last published state (${fileCount} files)`
              : (this.lastIndex.message ?? 'Loaded last published state'),
        };
        return this.lastIndex;
      } catch {
        // fall through
      }
    }
    try {
      const client = await this.ctx.ensureClient();
      const latest = await client.getLatestRepositoryState(this.ctx.getWorkspaceId());
      if (latest) {
        const descriptorStatus = indexStatusFromDescriptor(latest);
        this.lastIndex = {
          fileCount: this.lastIndex.fileCount,
          truncated: this.lastIndex.truncated,
          maximumIndexFiles,
          ...descriptorStatus,
          indexMode: this.lastIndex.indexMode,
          message:
            this.lastIndex.fileCount > 0
              ? `From in-memory repository state (${this.lastIndex.fileCount} files)`
              : 'From in-memory repository state',
        };
        return this.lastIndex;
      }
    } catch {
      // no state yet
    }
    return { ...this.lastIndex, maximumIndexFiles };
  }

  async publishIndexSnapshot(options: {
    force?: boolean;
    filePaths?: readonly string[];
    abortSignal?: AbortSignal;
    onProgress?: Parameters<typeof runFullWorkspaceIndex>[0]['onProgress'];
  } = {}): Promise<IndexStatusSnapshot> {
    const root = this.ctx.effectiveRoot();
    const maximumIndexFiles = readMaximumIndexFiles(this.ctx.vs);
    if (!root) {
      return {
        fileCount: 0,
        truncated: false,
        maximumIndexFiles,
        message: 'Open a workspace folder to index',
      };
    }
    const client = await this.ctx.ensureClient();
    const dir = scaffoldMitiiWorkspace(root);
    let fileCount = 0;
    let truncated = false;
    let indexMode: IndexStatusSnapshot['indexMode'] = 'full';
    let fallbackReason: string | undefined;
    let embeddingIssue: string | undefined;
    let published;
    try {
      const full = await runFullWorkspaceIndex({
        mitiiDir: dir,
        workspaceRoot: root,
        workspaceId: this.ctx.getWorkspaceId(),
        force: options.force === true,
        ...(options.filePaths?.length ? { filePaths: options.filePaths } : {}),
        ...(options.abortSignal ? { abortSignal: options.abortSignal } : {}),
        onProgress: (progress) => {
          options.onProgress?.(progress);
          this.lastIndex = {
            ...this.lastIndex,
            progressStage: progress.stage,
            discoveredFileCount: progress.fileCount ?? this.lastIndex.discoveredFileCount,
            readiness: 'indexing',
            message: progress.message,
          };
          this.ctx.post({ type: 'index.status', index: this.lastIndex });
        },
        semanticIndex: await resolveVsCodeSemanticIndexSettings(
          this.ctx.vs,
          this.ctx.secrets,
        ),
      });
      if (full.status === 'cancelled') {
        this.lastIndex = {
          fileCount: full.fileCount,
          truncated: full.truncated,
          maximumIndexFiles,
          message: 'Indexing cancelled',
        };
        return this.lastIndex;
      }
      if (full.status === 'skipped') {
        const rehydrated = await rehydrateRepositoryStateFromDisk({
          client,
          mitiiDir: dir,
          workspaceRoot: root,
          workspaceId: this.ctx.getWorkspaceId(),
          channel: this.ctx.channel,
        });
        if (rehydrated.ok) {
          await this.readIndexStatus();
          return {
            ...this.lastIndex,
            fileCount: Math.max(this.lastIndex.fileCount, full.fileCount),
            truncated: full.truncated,
            maximumIndexFiles,
            message: 'Indexing already in progress (using on-disk index)',
          };
        }
        return {
          ...this.lastIndex,
          fileCount: full.fileCount || this.lastIndex.fileCount,
          truncated: full.truncated,
          maximumIndexFiles,
          message: 'Indexing already in progress',
        };
      }
      fileCount = full.fileCount;
      truncated = full.truncated;
      if (full.vectorIndex.status !== 'ready') {
        embeddingIssue =
          full.vectorIndex.reason ??
          `vector index ${full.vectorIndex.status}`;
      }
      published = await client.publishRepositoryStateFromIndexing(full.indexing, {
        catalogRevisionByRoot: full.catalogRevisionByRoot,
        graphRevisionByRoot: full.graphRevisionByRoot,
        mapRevisionByRoot: full.mapRevisionByRoot,
      });
      if (full.status === 'unchanged') {
        this.ctx.channel.appendLine(
          `[index] unchanged (up to date) at ${full.databasePath}; vector=${full.vectorIndex.status}${full.vectorIndex.profileId ? ` profile=${full.vectorIndex.profileId}` : ''}${full.vectorIndex.reason ? ` reason=${full.vectorIndex.reason}` : ''}`,
        );
      } else {
        this.ctx.channel.appendLine(
          `[index] ${options.filePaths?.length ? 'incremental' : 'full'} code/text/graph/map index stored at ${full.databasePath}; vector=${full.vectorIndex.status}${full.vectorIndex.profileId ? ` profile=${full.vectorIndex.profileId}` : ''}${full.vectorIndex.reason ? ` reason=${full.vectorIndex.reason}` : ''}`,
        );
      }
    } catch (error) {
      if (
        error instanceof IndexLockedError ||
        (error instanceof Error && error.name === 'IndexLockedError')
      ) {
        this.ctx.channel.appendLine(
          `[index] skipped (lock held): ${error instanceof Error ? error.message : String(error)}`,
        );
        const rehydrated = await rehydrateRepositoryStateFromDisk({
          client,
          mitiiDir: dir,
          workspaceRoot: root,
          workspaceId: this.ctx.getWorkspaceId(),
          channel: this.ctx.channel,
        });
        if (rehydrated.ok) {
          await this.readIndexStatus();
          return {
            ...this.lastIndex,
            fileCount: Math.max(this.lastIndex.fileCount, rehydrated.fileCount),
            maximumIndexFiles,
            message: 'Indexing already in progress (using on-disk index)',
          };
        }
        return {
          ...this.lastIndex,
          maximumIndexFiles,
          message: 'Indexing already in progress',
        };
      }
      fallbackReason = error instanceof Error ? error.message : String(error);
      this.ctx.channel.appendLine(
        `[index] full index unavailable; falling back to host snapshot: ${fallbackReason}`,
      );
      indexMode = 'host_snapshot';
      const snapshot = await buildWorkspaceSnapshot({
        workspaceRoot: root,
        workspaceId: this.ctx.getWorkspaceId(),
        maxFiles: maximumIndexFiles,
      });
      fileCount = snapshot.fileCount;
      truncated = snapshot.truncated;
      published = await client.publishRepositoryState(snapshot.candidate);
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
      const descriptorStatus = indexStatusFromDescriptor(published.descriptor);
      const baseMessage =
        indexMode === 'host_snapshot'
          ? `Indexed ${fileCount} files (host snapshot fallback: ${fallbackReason ?? 'full index unavailable'})`
          : truncated
            ? `Indexed ${fileCount} files (truncated)`
            : `Indexed ${fileCount} files`;
      this.lastIndex = {
        fileCount,
        truncated,
        maximumIndexFiles,
        ...descriptorStatus,
        indexMode,
        message:
          embeddingIssue && indexMode !== 'host_snapshot'
            ? `${baseMessage} · embeddings unavailable: ${embeddingIssue}`
            : baseMessage,
      };
    } else {
      this.lastIndex = {
        fileCount,
        truncated,
        maximumIndexFiles,
        message: 'Index publish failed',
      };
    }
    return this.lastIndex;
  }
}
