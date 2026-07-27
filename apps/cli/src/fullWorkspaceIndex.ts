import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import Database from 'better-sqlite3';
import {
  NodeFileSystemAdapter,
  RepoGraphBuilder,
  RepoMapBuilder,
  SqliteCodeIndexAdapter,
  WorkspaceIndexingAdapterFactory,
  createDefaultProjectCatalogBuilder,
  type RepoGraph,
  type RepoMap,
  type WorkspaceSnapshot,
  type WorkspaceIndexingPipelineResult,
} from '@mitii/v8';

const MITII_DIR = '.mitii';
const INDEX_DB_FILE = 'repository-index.sqlite';
const DEFAULT_MAXIMUM_FILES = 2_000;

export interface FullWorkspaceIndexResult {
  indexing: WorkspaceIndexingPipelineResult;
  fileCount: number;
  truncated: boolean;
  databasePath: string;
  graphRevisionByRoot: Record<string, string>;
  mapRevisionByRoot: Record<string, string>;
  graphArtifactPaths: Record<string, string>;
  mapArtifactPaths: Record<string, string>;
}

export async function runFullWorkspaceIndex(options: {
  cwd: string;
  workspaceId: string;
  maximumFiles?: number;
}): Promise<FullWorkspaceIndexResult> {
  const dir = join(options.cwd, MITII_DIR);
  mkdirSync(dir, { recursive: true });

  const databasePath = join(dir, INDEX_DB_FILE);
  const database = new Database(databasePath);
  try {
    database.pragma('journal_mode = WAL');
    database.pragma('foreign_keys = ON');

    const fileSystem = new NodeFileSystemAdapter();
    const components = await new WorkspaceIndexingAdapterFactory().create({
      fileSystem,
      codeIndexDatabase: database,
      textIndexDatabase: database,
    });

    const maximumFiles = options.maximumFiles ?? DEFAULT_MAXIMUM_FILES;
    const snapshot = await components.scanner.scan({
      roots: [options.cwd],
      maximumFiles,
    });

    const indexing = await components.pipeline.execute({
      workspace: options.workspaceId,
      snapshot,
      indexedAt: Date.now(),
      maximumFiles,
      maximumReportedFileResults: maximumFiles,
      cleanupMissing: true,
      synchronizeEmbeddings: components.synchronizeEmbeddings,
    });

    const graphMap = await buildGraphMapArtifacts({
      database,
      dir,
      workspaceId: options.workspaceId,
      snapshot,
      fileSystem,
    });

    return {
      indexing,
      fileCount: snapshot.statistics.files,
      truncated: snapshot.status !== 'complete',
      databasePath,
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
  graphRevisionByRoot: Record<string, string>;
  mapRevisionByRoot: Record<string, string>;
  graphArtifactPaths: Record<string, string>;
  mapArtifactPaths: Record<string, string>;
}> {
  const catalog = await createDefaultProjectCatalogBuilder(
    options.fileSystem,
  ).build({ snapshot: options.snapshot });
  const graphRevisionByRoot: Record<string, string> = {};
  const mapRevisionByRoot: Record<string, string> = {};
  const graphArtifactPaths: Record<string, string> = {};
  const mapArtifactPaths: Record<string, string> = {};

  for (const root of options.snapshot.roots) {
    if (root.kind === 'unavailable') continue;
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
    graphRevisionByRoot,
    mapRevisionByRoot,
    graphArtifactPaths,
    mapArtifactPaths,
  };
}

function writeArtifact(path: string, artifact: RepoGraph | RepoMap): void {
  writeFileSync(path, `${JSON.stringify(artifact, null, 2)}\n`);
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
