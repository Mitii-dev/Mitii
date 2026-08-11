import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  NodeFileSystemAdapter,
  RepoGraphBuilder,
  RepoMapBuilder,
  SqliteCodeIndexAdapter,
  createWorkspaceIndexRuntime,
  createDefaultProjectCatalogBuilder,
  type RepoGraph,
  type RepoMap,
  type WorkspaceSnapshot,
  type WorkspaceIndexingPipelineResult,
} from '@mitii/v8';
import {
  OpenAiCompatibleEmbeddingProvider,
  createLanceDbConnection,
  readIndexRuntimeMetadata,
  writeIndexRuntimeMetadata,
  type IndexRuntimeMetadata,
  type SemanticIndexSettings,
} from './semanticIndex.js';
import { createDefaultTreeSitterRuntime } from './treeSitter/createDefaultTreeSitterRuntime.js';
import { fingerprintWorkspaceIndexSnapshot } from './fingerprintSnapshot.js';
import type {
  HostSqliteDatabase,
  OpenHostSqliteDatabase,
} from '../sqlite/types.js';

const INDEX_DB_FILE = 'repository-index.sqlite';
const LANCEDB_DIR = 'lancedb';
const INDEX_RUNTIME_FILE = 'index-runtime.json';
const DEFAULT_MAXIMUM_FILES = 2_000;

type BuiltProjectCatalog = Awaited<
  ReturnType<
    ReturnType<typeof createDefaultProjectCatalogBuilder>['build']
  >
>;

export interface FullWorkspaceIndexResult {
  status: 'indexed' | 'unchanged';
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
}

export async function runFullWorkspaceIndex(options: {
  mitiiDir: string;
  workspaceRoot: string;
  workspaceId: string;
  openDatabase: OpenHostSqliteDatabase;
  maximumFiles?: number;
  semanticIndex?: SemanticIndexSettings;
  force?: boolean;
  filePaths?: readonly string[];
}): Promise<FullWorkspaceIndexResult> {
  mkdirSync(options.mitiiDir, { recursive: true });

  const databasePath = join(options.mitiiDir, INDEX_DB_FILE);
  const lanceDbPath = join(options.mitiiDir, LANCEDB_DIR);
  const runtimeMetadataPath = join(options.mitiiDir, INDEX_RUNTIME_FILE);
  const previousMetadata = readIndexRuntimeMetadata(runtimeMetadataPath);
  const semanticProfile = options.semanticIndex?.enabled
    ? new OpenAiCompatibleEmbeddingProvider(options.semanticIndex).profile
    : undefined;
  const vectorRuntimeKey = semanticProfile?.id ?? 'unavailable';
  const database = options.openDatabase(databasePath);
  try {
    database.pragma('journal_mode = WAL');
    database.pragma('foreign_keys = ON');

    const fileSystem = new NodeFileSystemAdapter();
    const components = await createWorkspaceIndexRuntime({
      fileSystem,
      codeIndexDatabase: database as never,
      textIndexDatabase: database as never,
    });

    const maximumFiles = options.maximumFiles ?? DEFAULT_MAXIMUM_FILES;
    const snapshot = await components.scanner.scan({
      roots: [options.workspaceRoot],
      maximumFiles,
    });
    const snapshotFingerprint = fingerprintWorkspaceIndexSnapshot(snapshot);
    const unchangedCheck = {
      metadata: previousMetadata,
      workspaceId: options.workspaceId,
      snapshotFingerprint,
      vectorRuntimeKey,
      force: options.force === true,
      scoped: Boolean(options.filePaths?.length),
    };

    if (isUnchangedFullIndex(unchangedCheck)) {
      const metadata = unchangedCheck.metadata;
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
        catalogRevisionByRoot: metadata.catalogRevisionByRoot,
        graphRevisionByRoot: metadata.graphRevisionByRoot,
        mapRevisionByRoot: metadata.mapRevisionByRoot,
        graphArtifactPaths: metadata.graphArtifactPaths,
        mapArtifactPaths: metadata.mapArtifactPaths,
      };
    }

    const semanticRuntime = await resolveSemanticRuntime(
      options.semanticIndex,
      lanceDbPath,
    );
    const treeSitterRuntime = await createDefaultTreeSitterRuntime();
    const indexingRuntime =
      treeSitterRuntime || semanticRuntime.status === 'ready'
        ? await createWorkspaceIndexRuntime({
            fileSystem,
            codeIndexDatabase: database as never,
            textIndexDatabase: database as never,
            ...(treeSitterRuntime ? { treeSitterRuntime } : {}),
            ...(semanticRuntime.status === 'ready'
              ? { vector: semanticRuntime.vector }
              : {}),
          })
        : components;

    const cleanupMissing =
      snapshot.status === 'complete' && !options.filePaths?.length;

    const indexing = await indexingRuntime.pipeline.execute({
      workspace: options.workspaceId,
      snapshot,
      indexedAt: Date.now(),
      maximumFiles,
      maximumReportedFileResults: maximumFiles,
      cleanupMissing,
      ...(options.filePaths?.length ? { filePaths: options.filePaths } : {}),
      synchronizeEmbeddings: indexingRuntime.synchronizeEmbeddings,
    });

    const vectorIndex = resolveVectorIndexStatus({
      semanticRuntime,
      indexing,
      lanceDbPath,
      runtimeMetadataPath,
    });

    const graphMap = await buildGraphMapArtifacts({
      database,
      dir: options.mitiiDir,
      workspaceId: options.workspaceId,
      snapshot,
      fileSystem,
      previousMetadata,
      force: options.force === true,
      dirtyRootIds: dirtyRootIdsFromIndexing(indexing),
    });

    writeIndexRuntimeMetadata(runtimeMetadataPath, {
      schemaVersion: 1,
      workspaceId: options.workspaceId,
      sqlitePath: databasePath,
      lanceDbPath,
      ...(semanticRuntime.status === 'ready' && vectorIndex.status === 'ready'
        ? { embeddingProfile: semanticRuntime.provider.profile }
        : {}),
      vectorRuntimeKey:
        semanticRuntime.status === 'ready' && vectorIndex.status === 'ready'
          ? semanticRuntime.provider.profile.id
          : 'unavailable',
      snapshotFingerprint,
      fileCount: snapshot.statistics.files,
      truncated: snapshot.status !== 'complete',
      lastIndexingResult: indexing,
      ...graphMap,
      generatedAt: new Date(indexing.indexedAt).toISOString(),
    });

    return {
      status: 'indexed',
      indexing,
      fileCount: snapshot.statistics.files,
      truncated: snapshot.status !== 'complete',
      databasePath,
      vectorIndex,
      ...graphMap,
    };
  } finally {
    database.close();
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

function isUnchangedFullIndex(input: {
  metadata: IndexRuntimeMetadata | undefined;
  workspaceId: string;
  snapshotFingerprint: string;
  vectorRuntimeKey: string;
  force: boolean;
  scoped: boolean;
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
} {
  const metadata = input.metadata;

  if (
    input.force ||
    input.scoped ||
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

async function resolveSemanticRuntime(
  settings: SemanticIndexSettings | undefined,
  lanceDbPath: string,
): Promise<
  | {
      status: 'ready';
      provider: OpenAiCompatibleEmbeddingProvider;
      vector: {
        embeddingProvider: OpenAiCompatibleEmbeddingProvider;
        lanceConnection: Awaited<ReturnType<typeof createLanceDbConnection>>;
      };
    }
  | {
      status: 'unavailable';
      reason: string;
    }
> {
  if (!settings?.enabled) {
    return {
      status: 'unavailable',
      reason: 'Semantic index is disabled or not configured.',
    };
  }
  try {
    const provider = new OpenAiCompatibleEmbeddingProvider(settings);
    // Fail fast with a clear provider error before indexing hundreds of files.
    await provider.embed(['mitii semantic index probe']);
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
