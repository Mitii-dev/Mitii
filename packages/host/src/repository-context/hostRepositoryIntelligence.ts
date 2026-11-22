import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  repoGraphSchema,
  repoMapSchema,
  type RepoGraph,
  type RepoMap,
  type RepositoryRootState,
  type RepositoryStateDescriptor,
} from '@mitii/v8';

export function loadRepositoryIntelligence(
  workspaceRoot: string,
  descriptor: RepositoryStateDescriptor,
): {
  repoGraph?: RepoGraph;
  repoMap?: RepoMap;
} {
  const root = descriptor.roots.find(
    (candidate: RepositoryRootState) =>
      candidate.graphRevision || candidate.mapRevision,
  );
  if (!root) return {};
  const artifactRoot = safeArtifactName(root.rootId);
  const graphPath = join(workspaceRoot, '.mitii', `repository-graph-${artifactRoot}.json`);
  const mapPath = join(workspaceRoot, '.mitii', `repository-map-${artifactRoot}.json`);
  const repoGraph = root.graphRevision ? readJsonArtifact(graphPath, repoGraphSchema) : undefined;
  const repoMap = root.mapRevision ? readJsonArtifact(mapPath, repoMapSchema) : undefined;
  return {
    ...(repoGraph ? { repoGraph } : {}),
    ...(repoMap ? { repoMap } : {}),
  };
}

function readJsonArtifact<T>(
  path: string,
  schema: { parse(input: unknown): T },
): T | undefined {
  if (!existsSync(path)) return undefined;
  try {
    return schema.parse(JSON.parse(readFileSync(path, 'utf8')));
  } catch {
    return undefined;
  }
}

function safeArtifactName(value: string): string {
  return value.replace(/[^a-zA-Z0-9_.-]+/g, '_');
}
