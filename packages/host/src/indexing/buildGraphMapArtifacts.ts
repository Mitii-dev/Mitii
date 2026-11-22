import { createHash } from 'node:crypto';
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  RepoGraphBuilder,
  RepoMapBuilder,
  SqliteCodeIndexAdapter,
  createDefaultProjectCatalogBuilder,
  type NodeFileSystemAdapter,
  type RepoGraph,
  type RepoMap,
  type WorkspaceIndexingPipelineResult,
  type WorkspaceSnapshot,
} from '@mitii/v8';

import type { HostSqliteDatabase } from '../sqlite/types.js';
import { safeArtifactName } from './indexArtifactPaths.js';
import type { IndexRuntimeMetadata } from './semanticIndex.js';

type BuiltProjectCatalog = Awaited<
  ReturnType<
    ReturnType<typeof createDefaultProjectCatalogBuilder>['build']
  >
>;

export async function buildGraphMapArtifacts(options: {
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

export function dirtyRootIdsFromIndexing(
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
