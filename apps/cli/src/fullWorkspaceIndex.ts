import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
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
import Database from 'better-sqlite3';
import {
  OpenAiCompatibleEmbeddingProvider,
  createLanceDbConnection,
  writeIndexRuntimeMetadata,
  type SemanticIndexSettings,
} from './semanticIndex.js';

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
  cwd: string;
  workspaceId: string;
  maximumFiles?: number;
  semanticIndex?: SemanticIndexSettings;
}): Promise<FullWorkspaceIndexResult> {
  const mitiiDir = join(options.cwd, '.mitii');
  mkdirSync(mitiiDir, { recursive: true });

  const databasePath = join(mitiiDir, INDEX_DB_FILE);
  const lanceDbPath = join(mitiiDir, LANCEDB_DIR);
  const runtimeMetadataPath = join(mitiiDir, INDEX_RUNTIME_FILE);
  const database = new Database(databasePath);
  try {
    database.pragma('journal_mode = WAL');
    database.pragma('foreign_keys = ON');

    const fileSystem = new NodeFileSystemAdapter();
    const semanticRuntime = await resolveSemanticRuntime(
      options.semanticIndex,
      lanceDbPath,
    );
    const components = await createWorkspaceIndexRuntime({
      fileSystem,
      codeIndexDatabase: database,
      textIndexDatabase: database,
      ...(semanticRuntime.status === 'ready'
        ? { vector: semanticRuntime.vector }
        : {}),
    });

    const maximumFiles = options.maximumFiles ?? DEFAULT_MAXIMUM_FILES;
    const snapshot = await components.scanner.scan({
      roots: [options.cwd],
      maximumFiles,
    });
    const cleanupMissing = snapshot.status === 'complete';

    const indexing = await components.pipeline.execute({
      workspace: options.workspaceId,
      snapshot,
      indexedAt: Date.now(),
      maximumFiles,
      maximumReportedFileResults: maximumFiles,
      cleanupMissing,
      synchronizeEmbeddings: components.synchronizeEmbeddings,
    });

    const vectorIndex = finalizeVectorRuntimeMetadata({
      semanticRuntime,
      indexing,
      workspaceId: options.workspaceId,
      sqlitePath: databasePath,
      lanceDbPath,
      runtimeMetadataPath,
    });

    const graphMap = await buildGraphMapArtifacts({
      database,
      dir: mitiiDir,
      workspaceId: options.workspaceId,
      snapshot,
      fileSystem,
    });

    return {
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
  database: Database.Database;
  dir: string;
  workspaceId: string;
  snapshot: WorkspaceSnapshot;
  fileSystem: NodeFileSystemAdapter;
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
    const codeIndex = new SqliteCodeIndexAdapter(options.database, {
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
  return [
    catalog.workspaceSnapshotId,
    catalog.status,
    catalog.projects.length,
    catalog.warnings.length,
    catalog.generatedAt,
  ].join(':');
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

function finalizeVectorRuntimeMetadata(options: {
  semanticRuntime: Awaited<ReturnType<typeof resolveSemanticRuntime>>;
  indexing: WorkspaceIndexingPipelineResult;
  workspaceId: string;
  sqlitePath: string;
  lanceDbPath: string;
  runtimeMetadataPath: string;
}): FullWorkspaceIndexResult['vectorIndex'] {
  if (options.semanticRuntime.status !== 'ready') {
    removeStaleRuntimeMetadata(options.runtimeMetadataPath);
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
    writeIndexRuntimeMetadata(options.runtimeMetadataPath, {
      schemaVersion: 1,
      workspaceId: options.workspaceId,
      sqlitePath: options.sqlitePath,
      lanceDbPath: options.lanceDbPath,
      embeddingProfile: options.semanticRuntime.provider.profile,
      generatedAt: new Date(options.indexing.indexedAt).toISOString(),
    });

    return {
      status: 'ready',
      profileId: options.semanticRuntime.provider.profile.id,
      lanceDbPath: options.lanceDbPath,
      runtimeMetadataPath: options.runtimeMetadataPath,
    };
  }

  removeStaleRuntimeMetadata(options.runtimeMetadataPath);
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

function removeStaleRuntimeMetadata(path: string): void {
  try {
    rmSync(path, { force: true });
  } catch {
    // Best effort: stale metadata must not fail lexical indexing.
  }
}
