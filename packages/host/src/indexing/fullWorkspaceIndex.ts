import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  NodeFileSystemAdapter,
  REPOSITORY_INDEX_FORMAT,
  RepoGraphBuilder,
  RepoMapBuilder,
  SqliteCodeIndexAdapter,
  createWorkspaceIndexRuntime,
  createDefaultProjectCatalogBuilder,
  type EmbeddingProfile,
  type EmbeddingProvider,
  type RepoGraph,
  type RepoMap,
  type WorkspaceSnapshot,
  type WorkspaceIndexingPipelineResult,
} from '@mitii/v8';
import {
  createLanceDbConnection,
  probeEmbeddingProvider,
  readIndexRuntimeMetadata,
  resolveHostEmbeddingProvider,
  writeIndexRuntimeMetadata,
  type IndexRuntimeMetadata,
  type SemanticIndexSettings,
} from './semanticIndex.js';
import { createDefaultTreeSitterRuntime } from './treeSitter/createDefaultTreeSitterRuntime.js';
import { fingerprintWorkspaceIndexSnapshot } from './fingerprintSnapshot.js';
import {
  IndexLockedError,
  acquireIndexLock,
  clearIndexProgress,
  writeIndexProgress,
} from './indexLock.js';
import {
  MAXIMUM_INDEX_FILES,
  resolveIndexConcurrency,
  resolveIndexScanTimeoutMs,
  resolveMaximumIndexFiles,
} from './indexLimits.js';
import type {
  HostSqliteDatabase,
  OpenHostSqliteDatabase,
} from '../sqlite/types.js';

const INDEX_DB_FILE = 'repository-index.sqlite';
const LANCEDB_DIR = 'lancedb';
const INDEX_RUNTIME_FILE = 'index-runtime.json';

type BuiltProjectCatalog = Awaited<
  ReturnType<
    ReturnType<typeof createDefaultProjectCatalogBuilder>['build']
  >
>;

export type WorkspaceIndexProgressStage =
  | 'locking'
  | 'scanning'
  | 'indexing'
  | 'lexical_ready'
  | 'embedding'
  | 'graph'
  | 'complete'
  | 'cancelled'
  | 'rebuilding_corrupt';

export interface WorkspaceIndexProgress {
  stage: WorkspaceIndexProgressStage;
  message: string;
  fileCount?: number;
  /** 0–100 estimate for UI (stage-based; not a fake timer). */
  percent?: number;
  /**
   * True when FTS/symbols (+ graph) are published and the project is usable
   * while embeddings may still be running.
   */
  lexicalReady?: boolean;
  /** Embedding phase lifecycle for premium status UI. */
  embeddingPhase?: 'idle' | 'pending' | 'running' | 'ready' | 'degraded' | 'unavailable';
}

/** Conservative stage weights — embedding/graph often dominate wall time. */
export function estimateIndexProgressPercent(
  stage: WorkspaceIndexProgressStage,
): number {
  switch (stage) {
    case 'locking':
      return 2;
    case 'rebuilding_corrupt':
      return 5;
    case 'scanning':
      return 10;
    case 'indexing':
      return 32;
    case 'graph':
      return 48;
    case 'lexical_ready':
      return 55;
    case 'embedding':
      return 72;
    case 'complete':
      return 100;
    case 'cancelled':
      return 0;
    default:
      return 8;
  }
}

function emitProgress(
  mitiiDir: string,
  onProgress: ((progress: WorkspaceIndexProgress) => void) | undefined,
  progress: WorkspaceIndexProgress,
): void {
  const percent =
    progress.percent ?? estimateIndexProgressPercent(progress.stage);
  const next = { ...progress, percent };
  writeIndexProgress(mitiiDir, {
    stage: next.stage,
    message: next.message,
    percent,
    ...(typeof next.fileCount === 'number' ? { fileCount: next.fileCount } : {}),
    ...(next.lexicalReady ? { lexicalReady: true } : {}),
    ...(next.embeddingPhase ? { embeddingPhase: next.embeddingPhase } : {}),
  });
  onProgress?.(next);
}

export interface FullWorkspaceIndexResult {
  status: 'indexed' | 'unchanged' | 'skipped' | 'cancelled';
  skipReason?: 'locked';
  indexing: WorkspaceIndexingPipelineResult;
  fileCount: number;
  truncated: boolean;
  databasePath: string;
  catalogRevisionByRoot: Record<string, string>;
  graphRevisionByRoot: Record<string, string>;
  mapRevisionByRoot: Record<string, string>;
  graphArtifactPaths: Record<string, string>;
  mapArtifactPaths: Record<string, string>;
  vectorIndex: {
    status: 'ready' | 'unavailable' | 'degraded';
    profileId?: string;
    reason?: string;
    lanceDbPath?: string;
    runtimeMetadataPath?: string;
  };
  treeSitter: {
    status: 'ready' | 'unavailable';
    reason?: string;
  };
}

export async function runFullWorkspaceIndex(options: {
  mitiiDir: string;
  workspaceRoot: string;
  workspaceId: string;
  openDatabase: OpenHostSqliteDatabase;
  maximumFiles?: number;
  /** File-processing concurrency (1–32). Defaults via resolveIndexConcurrency. */
  concurrency?: number;
  semanticIndex?: SemanticIndexSettings;
  force?: boolean;
  filePaths?: readonly string[];
  abortSignal?: AbortSignal;
  onProgress?: (progress: WorkspaceIndexProgress) => void;
  /**
   * Fired after FTS/symbols (+ graph) are durable so hosts can publish a
   * usable state while embeddings continue (degraded vectors until done).
   */
  onLexicalReady?: (partial: FullWorkspaceIndexResult) => void | Promise<void>;
}): Promise<FullWorkspaceIndexResult> {
  mkdirSync(options.mitiiDir, { recursive: true });
  emitProgress(options.mitiiDir, options.onProgress, {
    stage: 'locking',
    message: 'Acquiring index lock',
  });

  let lock;
  try {
    lock = acquireIndexLock(options.mitiiDir);
  } catch (error) {
    // Full and incremental callers share one disk lock. Returning skipped with
    // prior metadata avoids treating contention as a hard failure (which used
    // to force host_snapshot → needsFullIndexRefresh loops in the VS Code host).
    if (error instanceof IndexLockedError) {
      const skipped = skippedFromPreviousMetadata(options);
      if (skipped) return skipped;
    }
    throw error;
  }

  try {
    const result = await runWithCorruptRetry(options);
    emitProgress(options.mitiiDir, options.onProgress, {
      stage: result.status === 'cancelled' ? 'cancelled' : 'complete',
      message:
        result.status === 'cancelled'
          ? 'Indexing cancelled'
          : result.status === 'unchanged'
            ? 'Index unchanged'
            : `Indexed ${result.fileCount} files`,
      fileCount: result.fileCount,
      percent: result.status === 'cancelled' ? 0 : 100,
    });
    if (result.status !== 'cancelled') {
      clearIndexProgress(options.mitiiDir);
    }
    return result;
  } finally {
    lock.release();
  }
}

async function runWithCorruptRetry(
  options: Parameters<typeof runFullWorkspaceIndex>[0],
): Promise<FullWorkspaceIndexResult> {
  try {
    return await runFullWorkspaceIndexOnce(options);
  } catch (error) {
    if (!isCorruptIndexError(error)) {
      throw error;
    }
    emitProgress(options.mitiiDir, options.onProgress, {
      stage: 'rebuilding_corrupt',
      message: 'Index store is corrupt; rebuilding',
    });
    removeCorruptIndexArtifacts(options.mitiiDir);
    return runFullWorkspaceIndexOnce({
      ...options,
      force: true,
    });
  }
}

async function runFullWorkspaceIndexOnce(options: {
  mitiiDir: string;
  workspaceRoot: string;
  workspaceId: string;
  openDatabase: OpenHostSqliteDatabase;
  maximumFiles?: number;
  concurrency?: number;
  semanticIndex?: SemanticIndexSettings;
  force?: boolean;
  filePaths?: readonly string[];
  abortSignal?: AbortSignal;
  onProgress?: (progress: WorkspaceIndexProgress) => void;
  onLexicalReady?: (partial: FullWorkspaceIndexResult) => void | Promise<void>;
}): Promise<FullWorkspaceIndexResult> {
  if (options.abortSignal?.aborted) {
    throw new Error('Workspace indexing was cancelled.');
  }

  const databasePath = join(options.mitiiDir, INDEX_DB_FILE);
  const lanceDbPath = join(options.mitiiDir, LANCEDB_DIR);
  const runtimeMetadataPath = join(options.mitiiDir, INDEX_RUNTIME_FILE);
  const previousMetadata = readIndexRuntimeMetadata(runtimeMetadataPath);
  const semanticCandidate = await resolveSemanticCandidate(options.semanticIndex);
  const semanticProfile =
    semanticCandidate.status === 'ready' ? semanticCandidate.profile : undefined;
  const vectorRuntimeKey = semanticProfile?.id ?? 'unavailable';
  const database = options.openDatabase(databasePath);
  let semanticRuntime: Awaited<ReturnType<typeof resolveSemanticRuntime>> | undefined;
  try {
    database.pragma('journal_mode = WAL');
    database.pragma('foreign_keys = ON');

    const fileSystem = new NodeFileSystemAdapter();
    const components = await createWorkspaceIndexRuntime({
      fileSystem,
      codeIndexDatabase: database as never,
      textIndexDatabase: database as never,
    });

    const maximumFiles = resolveMaximumIndexFiles(options.maximumFiles);
    emitProgress(options.mitiiDir, options.onProgress, {
      stage: 'scanning',
      message: 'Scanning workspace files',
    });
    const snapshot = await components.scanner.scan({
      roots: [options.workspaceRoot],
      maximumFiles,
      maximumDirectories: Math.max(10_000, maximumFiles),
      timeoutMs: resolveIndexScanTimeoutMs(maximumFiles),
    });
    const snapshotFingerprint = fingerprintWorkspaceIndexSnapshot(snapshot);
    const formatMismatch = hasIndexFormatMismatch(previousMetadata);
    const unchangedCheck = {
      metadata: previousMetadata,
      workspaceId: options.workspaceId,
      snapshotFingerprint,
      vectorRuntimeKey,
      force: options.force === true,
      scoped: Boolean(options.filePaths?.length),
      formatMismatch,
    };

    if (isUnchangedFullIndex(unchangedCheck)) {
      const metadata = unchangedCheck.metadata;
      emitProgress(options.mitiiDir, options.onProgress, {
        stage: 'complete',
        message: 'Index already up to date',
        fileCount: metadata.fileCount,
      });
      return {
        status: 'unchanged',
        indexing: metadata.lastIndexingResult,
        fileCount: metadata.fileCount,
        truncated: metadata.truncated,
        databasePath,
        vectorIndex: vectorIndexFromMetadata({
          metadata,
          semanticProfileId: semanticProfile?.id,
          lanceDbPath,
          runtimeMetadataPath,
        }),
        treeSitter: treeSitterStatusFromMetadata(metadata.treeSitterRuntime),
        catalogRevisionByRoot: metadata.catalogRevisionByRoot,
        graphRevisionByRoot: metadata.graphRevisionByRoot,
        mapRevisionByRoot: metadata.mapRevisionByRoot,
        graphArtifactPaths: metadata.graphArtifactPaths,
        mapArtifactPaths: metadata.mapArtifactPaths,
      };
    }

    const resolvedSemantic = await resolveSemanticRuntime(
      semanticCandidate,
      lanceDbPath,
    );
    semanticRuntime = resolvedSemantic;
    const treeSitterRuntime = await createDefaultTreeSitterRuntime();
    const treeSitter = treeSitterRuntime
      ? { status: 'ready' as const }
      : {
          status: 'unavailable' as const,
          reason:
            'Tree-sitter WASM runtime is unavailable; non-TypeScript languages fall back to regex symbol extraction.',
        };
    // Scan used a lightweight runtime so unchanged workspaces can return before
    // loading tree-sitter/embeddings. Rebuild with those only when indexing.
    const indexingRuntime =
      treeSitterRuntime || resolvedSemantic.status === 'ready'
        ? await createWorkspaceIndexRuntime({
            fileSystem,
            codeIndexDatabase: database as never,
            textIndexDatabase: database as never,
            ...(treeSitterRuntime ? { treeSitterRuntime } : {}),
            ...(resolvedSemantic.status === 'ready'
              ? { vector: resolvedSemantic.vector }
              : {}),
          })
        : components;

    const cleanupMissing =
      snapshot.status === 'complete' && !options.filePaths?.length;
    const concurrency = resolveIndexConcurrency(options.concurrency);
    const shouldSyncEmbeddings = indexingRuntime.synchronizeEmbeddings;

    emitProgress(options.mitiiDir, options.onProgress, {
      stage: 'indexing',
      message: `Indexing code and text (${concurrency} workers)`,
      fileCount: snapshot.statistics.files,
      embeddingPhase: shouldSyncEmbeddings ? 'pending' : 'unavailable',
    });

    // Phase 1 — FTS/symbols only. Publish mid-run so the project is usable
    // while embeddings continue (ARCHITECTURE §9–10 capability independence).
    const lexicalIndexing = await indexingRuntime.pipeline.execute({
      workspace: options.workspaceId,
      snapshot,
      indexedAt: Date.now(),
      maximumFiles,
      maximumReportedFileResults: Math.min(
        maximumFiles,
        MAXIMUM_INDEX_FILES,
      ),
      cleanupMissing,
      concurrency,
      ...(options.filePaths?.length ? { filePaths: options.filePaths } : {}),
      synchronizeEmbeddings: false,
      ...(options.abortSignal ? { abortSignal: options.abortSignal } : {}),
    });

    if (lexicalIndexing.status === 'cancelled' || options.abortSignal?.aborted) {
      emitProgress(options.mitiiDir, options.onProgress, {
        stage: 'cancelled',
        message: 'Indexing cancelled',
        fileCount: snapshot.statistics.files,
      });
      return {
        status: 'cancelled',
        indexing: lexicalIndexing,
        fileCount: snapshot.statistics.files,
        truncated: snapshot.status !== 'complete',
        databasePath,
        vectorIndex: {
          status: 'unavailable',
          reason: 'Indexing was cancelled.',
          lanceDbPath,
          runtimeMetadataPath,
        },
        treeSitter,
        catalogRevisionByRoot: {},
        graphRevisionByRoot: {},
        mapRevisionByRoot: {},
        graphArtifactPaths: {},
        mapArtifactPaths: {},
      };
    }

    emitProgress(options.mitiiDir, options.onProgress, {
      stage: 'graph',
      message: 'Building repository graph',
      fileCount: snapshot.statistics.files,
      lexicalReady: false,
      embeddingPhase: shouldSyncEmbeddings ? 'pending' : 'unavailable',
    });

    const graphMap = await buildGraphMapArtifacts({
      database,
      dir: options.mitiiDir,
      workspaceId: options.workspaceId,
      snapshot,
      fileSystem,
      previousMetadata,
      force: options.force === true || formatMismatch,
      dirtyRootIds: dirtyRootIdsFromIndexing(lexicalIndexing),
    });

    const degradedVector: FullWorkspaceIndexResult['vectorIndex'] =
      shouldSyncEmbeddings
        ? {
            status: 'degraded',
            profileId: resolvedSemantic.status === 'ready'
              ? resolvedSemantic.provider.profile.id
              : undefined,
            reason: 'Embeddings syncing in background.',
            lanceDbPath,
            runtimeMetadataPath,
          }
        : resolveVectorIndexStatus({
            semanticRuntime: resolvedSemantic,
            indexing: lexicalIndexing,
            lanceDbPath,
            runtimeMetadataPath,
          });

    writeIndexRuntimeMetadata(runtimeMetadataPath, {
      schemaVersion: 1,
      workspaceId: options.workspaceId,
      sqlitePath: databasePath,
      lanceDbPath,
      vectorRuntimeKey: shouldSyncEmbeddings
        ? 'pending'
        : resolvedSemantic.status === 'ready'
          ? resolvedSemantic.provider.profile.id
          : 'unavailable',
      ...(shouldSyncEmbeddings
        ? { lastEmbeddingError: 'Embeddings syncing in background.' }
        : resolvedSemantic.status === 'unavailable'
          ? { lastEmbeddingError: resolvedSemantic.reason }
          : {}),
      snapshotFingerprint,
      fileCount: snapshot.statistics.files,
      truncated: snapshot.status !== 'complete',
      lastIndexingResult: lexicalIndexing,
      textIndexSchemaVersion: REPOSITORY_INDEX_FORMAT.textIndexSchemaVersion,
      textPipelineVersion: REPOSITORY_INDEX_FORMAT.textPipelineVersion,
      graphBuilderVersion: REPOSITORY_INDEX_FORMAT.graphBuilderVersion,
      treeSitterRuntime: treeSitter.status,
      ...graphMap,
      generatedAt: new Date(lexicalIndexing.indexedAt).toISOString(),
    });

    const lexicalPartial: FullWorkspaceIndexResult = {
      status: 'indexed',
      indexing: lexicalIndexing,
      fileCount: snapshot.statistics.files,
      truncated: snapshot.status !== 'complete',
      databasePath,
      vectorIndex: degradedVector,
      treeSitter,
      ...graphMap,
    };

    emitProgress(options.mitiiDir, options.onProgress, {
      stage: 'lexical_ready',
      message: shouldSyncEmbeddings
        ? 'Search ready — embeddings running in background'
        : 'Index ready',
      fileCount: snapshot.statistics.files,
      lexicalReady: true,
      embeddingPhase: shouldSyncEmbeddings ? 'pending' : degradedVector.status,
      percent: estimateIndexProgressPercent('lexical_ready'),
    });

    try {
      await options.onLexicalReady?.(lexicalPartial);
    } catch {
      // Host publish failures must not abort embedding sync.
    }

    let indexing = lexicalIndexing;
    let vectorIndex = degradedVector;

    if (shouldSyncEmbeddings && !options.abortSignal?.aborted) {
      emitProgress(options.mitiiDir, options.onProgress, {
        stage: 'embedding',
        message: 'Building embeddings',
        fileCount: snapshot.statistics.files,
        lexicalReady: true,
        embeddingPhase: 'running',
      });

      const embeddingPass = await indexingRuntime.pipeline.execute({
        workspace: options.workspaceId,
        snapshot,
        indexedAt: Date.now(),
        maximumFiles,
        maximumReportedFileResults: Math.min(
          maximumFiles,
          MAXIMUM_INDEX_FILES,
        ),
        cleanupMissing: false,
        concurrency,
        finalizeOnly: true,
        synchronizeEmbeddings: true,
        ...(options.abortSignal ? { abortSignal: options.abortSignal } : {}),
      });

      if (
        embeddingPass.status === 'cancelled' ||
        options.abortSignal?.aborted
      ) {
        // Lexical indexes remain usable; vectors stay degraded.
        writeIndexRuntimeMetadata(runtimeMetadataPath, {
          schemaVersion: 1,
          workspaceId: options.workspaceId,
          sqlitePath: databasePath,
          lanceDbPath,
          vectorRuntimeKey: 'unavailable',
          lastEmbeddingError: 'Embedding synchronization was cancelled.',
          snapshotFingerprint,
          fileCount: snapshot.statistics.files,
          truncated: snapshot.status !== 'complete',
          lastIndexingResult: lexicalIndexing,
          textIndexSchemaVersion: REPOSITORY_INDEX_FORMAT.textIndexSchemaVersion,
          textPipelineVersion: REPOSITORY_INDEX_FORMAT.textPipelineVersion,
          graphBuilderVersion: REPOSITORY_INDEX_FORMAT.graphBuilderVersion,
          treeSitterRuntime: treeSitter.status,
          ...graphMap,
          generatedAt: new Date(lexicalIndexing.indexedAt).toISOString(),
        });
        emitProgress(options.mitiiDir, options.onProgress, {
          stage: 'complete',
          message: 'Search ready (embeddings paused)',
          fileCount: snapshot.statistics.files,
          lexicalReady: true,
          embeddingPhase: 'degraded',
          percent: 100,
        });
        return {
          ...lexicalPartial,
          vectorIndex: {
            ...degradedVector,
            status: 'degraded',
            reason: 'Embedding synchronization was cancelled.',
          },
        };
      }

      indexing = mergeLexicalAndEmbeddingResults(
        lexicalIndexing,
        embeddingPass,
      );
      vectorIndex = resolveVectorIndexStatus({
        semanticRuntime: resolvedSemantic,
        indexing,
        lanceDbPath,
        runtimeMetadataPath,
      });

      writeIndexRuntimeMetadata(runtimeMetadataPath, {
        schemaVersion: 1,
        workspaceId: options.workspaceId,
        sqlitePath: databasePath,
        lanceDbPath,
        ...(resolvedSemantic.status === 'ready' && vectorIndex.status === 'ready'
          ? { embeddingProfile: resolvedSemantic.provider.profile }
          : {}),
        vectorRuntimeKey:
          resolvedSemantic.status === 'ready' && vectorIndex.status === 'ready'
            ? resolvedSemantic.provider.profile.id
            : 'unavailable',
        ...(vectorIndex.status !== 'ready'
          ? {
              lastEmbeddingError:
                vectorIndex.reason ??
                (resolvedSemantic.status === 'unavailable'
                  ? resolvedSemantic.reason
                  : 'Embedding synchronization did not complete.'),
            }
          : {}),
        snapshotFingerprint,
        fileCount: snapshot.statistics.files,
        truncated: snapshot.status !== 'complete',
        lastIndexingResult: indexing,
        textIndexSchemaVersion: REPOSITORY_INDEX_FORMAT.textIndexSchemaVersion,
        textPipelineVersion: REPOSITORY_INDEX_FORMAT.textPipelineVersion,
        graphBuilderVersion: REPOSITORY_INDEX_FORMAT.graphBuilderVersion,
        treeSitterRuntime: treeSitter.status,
        ...graphMap,
        generatedAt: new Date(indexing.indexedAt).toISOString(),
      });
    }

    emitProgress(options.mitiiDir, options.onProgress, {
      stage: 'complete',
      message:
        vectorIndex.status === 'ready'
          ? 'Index updated'
          : vectorIndex.status === 'degraded'
            ? 'Index updated (embeddings degraded)'
            : 'Index updated',
      fileCount: snapshot.statistics.files,
      lexicalReady: true,
      embeddingPhase: vectorIndex.status,
    });

    return {
      status: 'indexed',
      indexing,
      fileCount: snapshot.statistics.files,
      truncated: snapshot.status !== 'complete',
      databasePath,
      vectorIndex,
      treeSitter,
      ...graphMap,
    };
  } finally {
    await disposeSemanticRuntime(semanticRuntime);
    database.close();
  }
}

async function disposeSemanticRuntime(
  semanticRuntime:
    | Awaited<ReturnType<typeof resolveSemanticRuntime>>
    | undefined,
): Promise<void> {
  if (!semanticRuntime || semanticRuntime.status !== 'ready') {
    return;
  }
  try {
    // Close Lance eagerly; the embedding provider may still be reused by the
    // same process (CLI ask indexes then retrieves). WASM ORT does not abort
    // on process teardown, so skipping provider.dispose here is intentional.
    semanticRuntime.vector.lanceConnection.close?.();
  } catch {
    // Best-effort: Lance close must not mask the indexing result.
  }
}

async function buildGraphMapArtifacts(options: {
  database: HostSqliteDatabase;
  dir: string;
  workspaceId: string;
  snapshot: WorkspaceSnapshot;
  fileSystem: NodeFileSystemAdapter;
  previousMetadata?: IndexRuntimeMetadata;
  force?: boolean;
  dirtyRootIds?: ReadonlySet<string>;
}): Promise<{
  catalogRevisionByRoot: Record<string, string>;
  graphRevisionByRoot: Record<string, string>;
  mapRevisionByRoot: Record<string, string>;
  graphArtifactPaths: Record<string, string>;
  mapArtifactPaths: Record<string, string>;
}> {
  const catalog = await createDefaultProjectCatalogBuilder(
    options.fileSystem,
  ).build({ snapshot: options.snapshot });
  const catalogPath = join(options.dir, 'repository-catalog.json');
  writeArtifact(catalogPath, catalog);
  const catalogRevision = catalogRevisionToken(catalog);

  const catalogRevisionByRoot: Record<string, string> = {};
  const graphRevisionByRoot: Record<string, string> = {};
  const mapRevisionByRoot: Record<string, string> = {};
  const graphArtifactPaths: Record<string, string> = {};
  const mapArtifactPaths: Record<string, string> = {};

  for (const root of options.snapshot.roots) {
    if (root.kind === 'unavailable') continue;
    catalogRevisionByRoot[root.id] = catalogRevision;
    const previousCanBeReused =
      options.force !== true &&
      !options.dirtyRootIds?.has(root.id) &&
      options.previousMetadata?.catalogRevisionByRoot?.[root.id] ===
        catalogRevision &&
      options.previousMetadata.graphRevisionByRoot?.[root.id] &&
      options.previousMetadata.mapRevisionByRoot?.[root.id] &&
      options.previousMetadata.graphArtifactPaths?.[root.id] &&
      options.previousMetadata.mapArtifactPaths?.[root.id] &&
      existsSync(options.previousMetadata.graphArtifactPaths[root.id]!) &&
      existsSync(options.previousMetadata.mapArtifactPaths[root.id]!);

    if (previousCanBeReused) {
      graphRevisionByRoot[root.id] =
        options.previousMetadata!.graphRevisionByRoot![root.id]!;
      mapRevisionByRoot[root.id] =
        options.previousMetadata!.mapRevisionByRoot![root.id]!;
      graphArtifactPaths[root.id] =
        options.previousMetadata!.graphArtifactPaths![root.id]!;
      mapArtifactPaths[root.id] =
        options.previousMetadata!.mapArtifactPaths![root.id]!;
      continue;
    }

    const codeIndex = new SqliteCodeIndexAdapter(options.database as never, {
      workspace: options.workspaceId,
      rootId: root.id,
    });
    const graph = await new RepoGraphBuilder(codeIndex).build({
      snapshot: options.snapshot,
      catalog,
      rootIds: [root.id],
    });
    const repoMap = new RepoMapBuilder().build({ graph });
    const graphPath = join(
      options.dir,
      `repository-graph-${safeArtifactName(root.id)}.json`,
    );
    const mapPath = join(
      options.dir,
      `repository-map-${safeArtifactName(root.id)}.json`,
    );
    writeArtifact(graphPath, graph);
    writeArtifact(mapPath, repoMap);
    graphRevisionByRoot[root.id] = graph.codeIndexChangeToken;
    mapRevisionByRoot[root.id] = mapRevision(repoMap);
    graphArtifactPaths[root.id] = graphPath;
    mapArtifactPaths[root.id] = mapPath;
  }

  return {
    catalogRevisionByRoot,
    graphRevisionByRoot,
    mapRevisionByRoot,
    graphArtifactPaths,
    mapArtifactPaths,
  };
}

function writeArtifact(
  path: string,
  artifact: RepoGraph | RepoMap | BuiltProjectCatalog,
): void {
  writeFileSync(path, `${JSON.stringify(artifact, null, 2)}\n`);
}

function catalogRevisionToken(catalog: BuiltProjectCatalog): string {
  return createHash('sha256')
    .update(stableStringify(stripGeneratedAt(catalog)))
    .digest('hex')
    .slice(0, 32);
}

function mapRevision(repoMap: RepoMap): string {
  return [
    repoMap.codeIndexChangeToken,
    repoMap.statistics.includedFiles,
    repoMap.statistics.includedSymbols,
    repoMap.statistics.estimatedTokens,
  ].join(':');
}

function safeArtifactName(value: string): string {
  return value.replace(/[^a-zA-Z0-9_.-]+/g, '_');
}

function treeSitterStatusFromMetadata(
  status: IndexRuntimeMetadata['treeSitterRuntime'],
): FullWorkspaceIndexResult['treeSitter'] {
  if (status === 'ready') {
    return { status: 'ready' };
  }
  return {
    status: 'unavailable',
    reason:
      'Tree-sitter WASM runtime is unavailable; non-TypeScript languages fall back to regex symbol extraction.',
  };
}

function hasIndexFormatMismatch(
  metadata: IndexRuntimeMetadata | undefined,
): boolean {
  return (
    metadata?.textIndexSchemaVersion !==
      REPOSITORY_INDEX_FORMAT.textIndexSchemaVersion ||
    metadata?.textPipelineVersion !==
      REPOSITORY_INDEX_FORMAT.textPipelineVersion ||
    metadata?.graphBuilderVersion !==
      REPOSITORY_INDEX_FORMAT.graphBuilderVersion
  );
}

function isUnchangedFullIndex(input: {
  metadata: IndexRuntimeMetadata | undefined;
  workspaceId: string;
  snapshotFingerprint: string;
  vectorRuntimeKey: string;
  force: boolean;
  scoped: boolean;
  formatMismatch: boolean;
}): input is {
  metadata: IndexRuntimeMetadata & {
    snapshotFingerprint: string;
    fileCount: number;
    truncated: boolean;
    lastIndexingResult: WorkspaceIndexingPipelineResult;
    catalogRevisionByRoot: Record<string, string>;
    graphRevisionByRoot: Record<string, string>;
    mapRevisionByRoot: Record<string, string>;
    graphArtifactPaths: Record<string, string>;
    mapArtifactPaths: Record<string, string>;
  };
  workspaceId: string;
  snapshotFingerprint: string;
  vectorRuntimeKey: string;
  force: boolean;
  scoped: boolean;
  formatMismatch: boolean;
} {
  const metadata = input.metadata;

  if (
    input.force ||
    input.scoped ||
    input.formatMismatch ||
    !metadata ||
    metadata.workspaceId !== input.workspaceId ||
    metadata.snapshotFingerprint !== input.snapshotFingerprint ||
    metadata.vectorRuntimeKey !== input.vectorRuntimeKey ||
    typeof metadata.fileCount !== 'number' ||
    typeof metadata.truncated !== 'boolean' ||
    !metadata.lastIndexingResult ||
    !metadata.catalogRevisionByRoot ||
    !metadata.graphRevisionByRoot ||
    !metadata.mapRevisionByRoot ||
    !metadata.graphArtifactPaths ||
    !metadata.mapArtifactPaths
  ) {
    return false;
  }

  return [
    ...Object.values(metadata.graphArtifactPaths),
    ...Object.values(metadata.mapArtifactPaths),
  ].every((path) => existsSync(path));
}

function vectorIndexFromMetadata(input: {
  metadata: IndexRuntimeMetadata;
  semanticProfileId?: string;
  lanceDbPath: string;
  runtimeMetadataPath: string;
}): FullWorkspaceIndexResult['vectorIndex'] {
  if (
    input.semanticProfileId &&
    input.metadata.embeddingProfile?.id === input.semanticProfileId
  ) {
    return {
      status: 'ready',
      profileId: input.semanticProfileId,
      lanceDbPath: input.lanceDbPath,
      runtimeMetadataPath: input.runtimeMetadataPath,
    };
  }

  return {
    status: 'unavailable',
    reason: 'Semantic index is disabled or not configured.',
  };
}

function mergeLexicalAndEmbeddingResults(
  lexical: WorkspaceIndexingPipelineResult,
  embedding: WorkspaceIndexingPipelineResult,
): WorkspaceIndexingPipelineResult {
  const embeddingByRoot = new Map(
    embedding.rootResults.map((root) => [root.rootId, root]),
  );

  const rootResults = lexical.rootResults.map((root) => {
    const emb = embeddingByRoot.get(root.rootId);
    if (!emb) return root;

    const embeddingWarnings = emb.warnings.filter(
      (warning) => warning.stage === 'embedding',
    );
    const structuralPartial =
      root.status === 'partial' ||
      emb.status === 'partial' ||
      emb.embeddingStatus === 'partial';

    return {
      ...root,
      status:
        emb.status === 'cancelled' || root.status === 'cancelled'
          ? ('cancelled' as const)
          : structuralPartial
            ? ('partial' as const)
            : root.status === 'skipped' && emb.status === 'complete'
              ? ('complete' as const)
              : root.status,
      ...(emb.embeddingStatus
        ? { embeddingStatus: emb.embeddingStatus }
        : {}),
      ...(emb.embeddingProfileId
        ? { embeddingProfileId: emb.embeddingProfileId }
        : {}),
      ...(emb.initialTextRevision !== undefined
        ? { initialTextRevision: emb.initialTextRevision }
        : {}),
      ...(emb.finalTextRevision !== undefined
        ? { finalTextRevision: emb.finalTextRevision }
        : {}),
      ...(emb.latestTextRevision !== undefined
        ? { latestTextRevision: emb.latestTextRevision }
        : {}),
      embeddedChunks: emb.embeddedChunks,
      vectorsDeleted: emb.vectorsDeleted,
      warnings: [...root.warnings, ...embeddingWarnings],
    };
  });

  return {
    ...lexical,
    rootResults,
    warnings: [
      ...lexical.warnings,
      ...embedding.warnings.filter((warning) => warning.stage === 'embedding'),
    ],
    statistics: {
      ...lexical.statistics,
      embeddedChunks: embedding.statistics.embeddedChunks,
    },
  };
}

function dirtyRootIdsFromIndexing(
  indexing: WorkspaceIndexingPipelineResult,
): ReadonlySet<string> {
  const dirty = new Set<string>();

  for (const file of indexing.fileResults) {
    if (file.codeIndexChanged || file.status !== 'complete') {
      dirty.add(file.rootId);
    }
  }

  for (const root of indexing.rootResults) {
    if (
      root.codeIndexRemovedFiles > 0 ||
      root.status !== 'complete'
    ) {
      dirty.add(root.rootId);
    }
  }

  return dirty;
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  }

  const object = value as Record<string, unknown>;
  return `{${Object.keys(object)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(object[key])}`)
    .join(',')}}`;
}

function stripGeneratedAt(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => stripGeneratedAt(item));
  }

  if (!value || typeof value !== 'object') {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([key]) => key !== 'generatedAt')
      .map(([key, item]) => [key, stripGeneratedAt(item)]),
  );
}

type SemanticRuntimeCandidate =
  | {
      status: 'ready';
      settings: SemanticIndexSettings;
      profile: EmbeddingProfile;
    }
  | {
      status: 'unavailable';
      reason: string;
    };

async function resolveSemanticCandidate(
  settings: SemanticIndexSettings | undefined,
): Promise<SemanticRuntimeCandidate> {
  if (!settings?.enabled) {
    return {
      status: 'unavailable',
      reason: 'Semantic index is disabled or not configured.',
    };
  }

  const probe = await probeEmbeddingProvider(settings);
  if (!probe.ok) {
    return {
      status: 'unavailable',
      reason: probe.reason,
    };
  }

  const runtimeSettings =
    probe.dimensions === settings.dimensions
      ? settings
      : {
          ...settings,
          dimensions: probe.dimensions,
        };
  const provider = await resolveHostEmbeddingProvider(runtimeSettings);

  return {
    status: 'ready',
    settings: runtimeSettings,
    profile: provider.profile,
  };
}

async function resolveSemanticRuntime(
  candidate: SemanticRuntimeCandidate,
  lanceDbPath: string,
): Promise<
  | {
      status: 'ready';
      provider: EmbeddingProvider;
      vector: {
        embeddingProvider: EmbeddingProvider;
        lanceConnection: Awaited<ReturnType<typeof createLanceDbConnection>>;
      };
    }
  | {
      status: 'unavailable';
      reason: string;
    }
> {
  if (candidate.status !== 'ready') {
    return {
      status: 'unavailable',
      reason: candidate.reason,
    };
  }
  try {
    const provider = await resolveHostEmbeddingProvider(candidate.settings);
    const lanceConnection = await createLanceDbConnection(lanceDbPath);
    return {
      status: 'ready',
      provider,
      vector: {
        embeddingProvider: provider,
        lanceConnection,
      },
    };
  } catch (error) {
    return {
      status: 'unavailable',
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

function resolveVectorIndexStatus(options: {
  semanticRuntime: Awaited<ReturnType<typeof resolveSemanticRuntime>>;
  indexing: WorkspaceIndexingPipelineResult;
  lanceDbPath: string;
  runtimeMetadataPath: string;
}): FullWorkspaceIndexResult['vectorIndex'] {
  if (options.semanticRuntime.status !== 'ready') {
    return {
      status: 'unavailable',
      reason: options.semanticRuntime.reason,
    };
  }

  const embeddingWarnings = options.indexing.rootResults.flatMap(
    (root: WorkspaceIndexingPipelineResult['rootResults'][number]) =>
      root.warnings
        .filter(
          (
            warning: WorkspaceIndexingPipelineResult['rootResults'][number]['warnings'][number],
          ) => warning.stage === 'embedding',
        )
        .map(
          (
            warning: WorkspaceIndexingPipelineResult['rootResults'][number]['warnings'][number],
          ) => warning.message,
        ),
  );
  const vectorReady =
    options.indexing.rootResults.length > 0 &&
    options.indexing.rootResults.every(
      (root: WorkspaceIndexingPipelineResult['rootResults'][number]) =>
        root.embeddingStatus === 'complete' ||
        root.embeddingStatus === 'unchanged',
    );

  if (vectorReady) {
    return {
      status: 'ready',
      profileId: options.semanticRuntime.provider.profile.id,
      lanceDbPath: options.lanceDbPath,
      runtimeMetadataPath: options.runtimeMetadataPath,
    };
  }

  const anyPartial = options.indexing.rootResults.some(
    (root: WorkspaceIndexingPipelineResult['rootResults'][number]) =>
      root.embeddingStatus === 'partial',
  );
  return {
    status: anyPartial ? 'degraded' : 'unavailable',
    profileId: options.semanticRuntime.provider.profile.id,
    reason:
      embeddingWarnings.join('; ') ||
      'Embedding synchronization did not complete for every root.',
    lanceDbPath: options.lanceDbPath,
    runtimeMetadataPath: options.runtimeMetadataPath,
  };
}

function skippedFromPreviousMetadata(options: {
  mitiiDir: string;
  workspaceId: string;
}): FullWorkspaceIndexResult | undefined {
  const databasePath = join(options.mitiiDir, INDEX_DB_FILE);
  const lanceDbPath = join(options.mitiiDir, LANCEDB_DIR);
  const runtimeMetadataPath = join(options.mitiiDir, INDEX_RUNTIME_FILE);
  const metadata = readIndexRuntimeMetadata(runtimeMetadataPath);
  if (
    !metadata ||
    metadata.workspaceId !== options.workspaceId ||
    !metadata.lastIndexingResult ||
    typeof metadata.fileCount !== 'number'
  ) {
    return undefined;
  }

  return {
    status: 'skipped',
    skipReason: 'locked',
    indexing: metadata.lastIndexingResult,
    fileCount: metadata.fileCount,
    truncated: metadata.truncated ?? false,
    databasePath,
    vectorIndex: vectorIndexFromMetadata({
      metadata,
      semanticProfileId: metadata.embeddingProfile?.id,
      lanceDbPath,
      runtimeMetadataPath,
    }),
    treeSitter: treeSitterStatusFromMetadata(metadata.treeSitterRuntime),
    catalogRevisionByRoot: metadata.catalogRevisionByRoot ?? {},
    graphRevisionByRoot: metadata.graphRevisionByRoot ?? {},
    mapRevisionByRoot: metadata.mapRevisionByRoot ?? {},
    graphArtifactPaths: metadata.graphArtifactPaths ?? {},
    mapArtifactPaths: metadata.mapArtifactPaths ?? {},
  };
}

function isCorruptIndexError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  const cause =
    error instanceof Error && error.cause instanceof Error
      ? error.cause.message
      : '';
  return /SQLITE_CORRUPT|SQLITE_NOTADB|SQLITE_IOERR|SQLITE_FULL|database disk image is malformed|not a database|file is not a database/i.test(
    `${message}\n${cause}`,
  );
}

function removeCorruptIndexArtifacts(mitiiDir: string): void {
  for (const name of [INDEX_DB_FILE, `${INDEX_DB_FILE}-wal`, `${INDEX_DB_FILE}-shm`, LANCEDB_DIR, INDEX_RUNTIME_FILE]) {
    rmSync(join(mitiiDir, name), { recursive: true, force: true });
  }
}
