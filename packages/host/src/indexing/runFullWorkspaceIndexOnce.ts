import { join } from 'node:path';

import {
  NodeFileSystemAdapter,
  REPOSITORY_INDEX_FORMAT,
  createWorkspaceIndexRuntime,
} from '@mitii/v8';

import { fingerprintWorkspaceIndexSnapshot } from './fingerprintSnapshot.js';
import {
  INDEX_DB_FILE,
  INDEX_RUNTIME_FILE,
  LANCEDB_DIR,
} from './indexArtifactPaths.js';
import {
  MAXIMUM_INDEX_FILES,
  resolveIndexConcurrency,
  resolveIndexScanTimeoutMs,
  resolveMaximumIndexFiles,
} from './indexLimits.js';
import {
  readIndexRuntimeMetadata,
  writeIndexRuntimeMetadata,
} from './semanticIndex.js';
import { createDefaultTreeSitterRuntime } from './treeSitter/createDefaultTreeSitterRuntime.js';
import {
  buildGraphMapArtifacts,
  dirtyRootIdsFromIndexing,
} from './buildGraphMapArtifacts.js';
import {
  disposeSemanticRuntime,
  mergeLexicalAndEmbeddingResults,
  resolveSemanticCandidate,
  resolveSemanticRuntime,
  resolveVectorIndexStatus,
} from './workspaceIndexSemanticRuntime.js';
import {
  emitProgress,
  estimateIndexProgressPercent,
} from './workspaceIndexProgress.js';
import type {
  FullWorkspaceIndexOptions,
  FullWorkspaceIndexResult,
} from './workspaceIndexTypes.js';
import {
  hasIndexFormatMismatch,
  isUnchangedFullIndex,
  treeSitterStatusFromMetadata,
  vectorIndexFromMetadata,
} from './workspaceIndexUnchanged.js';

export async function runFullWorkspaceIndexOnce(
  options: FullWorkspaceIndexOptions,
): Promise<FullWorkspaceIndexResult> {
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

 // FTS/symbols only. Publish mid-run so the project is usable
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

    // SCIP enrichment is non-blocking — never delay lexical-ready UX.
    try {
      const { scheduleScipEnrichment } = await import(
        './scip/ScipEnrichmentAdapter.js'
      );
      scheduleScipEnrichment({
        workspaceRoot: options.workspaceRoot,
        openDatabase: options.openDatabase,
        workspaceId: options.workspaceId,
      });
    } catch {
      /* optional path */
    }

    let indexing = lexicalIndexing;
    let vectorIndex = degradedVector;

    if (shouldSyncEmbeddings && !options.abortSignal?.aborted) {
      const fileCount = snapshot.statistics.files;
      const filesPerSec =
        options.semanticIndex?.source === 'ollama' ||
        options.semanticIndex?.source === 'openai-compatible'
          ? 12
          : 45;
      const etaMin = Math.max(1, Math.ceil(fileCount / filesPerSec / 60));
      emitProgress(options.mitiiDir, options.onProgress, {
        stage: 'embedding',
        message: `Building embeddings (~${etaMin} min for ${fileCount.toLocaleString()} files)`,
        fileCount,
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
