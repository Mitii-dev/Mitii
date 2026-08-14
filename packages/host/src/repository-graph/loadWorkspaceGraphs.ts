import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { repoGraphSchema, type RepositoryGraphPort, type RepoGraph } from '@mitii/v8';

import { readIndexRuntimeMetadata } from '../indexing/semanticIndex.js';

interface IndexRuntimeGraphMetadata {
  graphArtifactPaths?: Record<string, string>;
  graphRevisionByRoot?: Record<string, string>;
  snapshotFingerprint?: string;
  generatedAt?: string;
}

/** Returned when live workspace files diverge from the published graph watermark. */
export const WORKSPACE_DIRTY_CHANGE_TOKEN_SUFFIX = ':workspace-dirty' as const;

export function loadWorkspaceGraphs(workspaceRoot: string): RepoGraph[] {
  const mitiiDir = join(workspaceRoot, '.mitii');
  if (!existsSync(mitiiDir)) return [];

  const graphs: RepoGraph[] = [];
  const metadata = readIndexRuntimeGraphMetadata(mitiiDir);
  const artifactPaths = new Set<string>();

  for (const path of Object.values(metadata?.graphArtifactPaths ?? {})) {
    artifactPaths.add(path);
  }

  artifactPaths.add(join(mitiiDir, 'repository-graph-workspace.json'));

  for (const path of artifactPaths) {
    if (!existsSync(path)) continue;
    try {
      graphs.push(repoGraphSchema.parse(JSON.parse(readFileSync(path, 'utf8'))));
    } catch {
      continue;
    }
  }

  return graphs;
}

export function createHostRepositoryGraphPort(options: {
  workspaceRoot: string;
}): RepositoryGraphPort {
  return {
    loadGraphs: () => loadWorkspaceGraphs(options.workspaceRoot),
    expectedCodeIndexChangeToken: (graph) =>
      resolveExpectedCodeIndexChangeToken(options.workspaceRoot, graph),
  };
}

/**
 * Resolve the live/expected code-index watermark for a graph.
 *
 * Returns a value different from `graph.codeIndexChangeToken` when:
 * - published index metadata revision disagrees with the artifact, or
 * - any file node in the graph is missing or newer than `graph.generatedAt`
 *   (workspace changed after the graph was built).
 */
export function resolveExpectedCodeIndexChangeToken(
  workspaceRoot: string,
  graph: RepoGraph,
): string | undefined {
  const metadata = readIndexRuntimeGraphMetadata(join(workspaceRoot, '.mitii'));
  const published = resolvePublishedRevision(metadata, graph);

  if (workspaceGraphLooksStale(workspaceRoot, graph)) {
    const base = published ?? graph.codeIndexChangeToken;
    return `${base}${WORKSPACE_DIRTY_CHANGE_TOKEN_SUFFIX}`;
  }

  return published;
}

function resolvePublishedRevision(
  metadata: IndexRuntimeGraphMetadata | undefined,
  graph: RepoGraph,
): string | undefined {
  const revisions = metadata?.graphRevisionByRoot;
  if (!revisions) return undefined;

  for (const rootId of collectGraphRootIds(graph)) {
    const expected = revisions[rootId];
    if (expected) return expected;
  }

  // Single-root / workspace-wide metadata with one published revision.
  const values = Object.values(revisions);
  return values.length === 1 ? values[0] : undefined;
}

/**
 * True when any file represented in the graph is missing or has mtime newer
 * than the graph generation timestamp.
 */
export function workspaceGraphLooksStale(
  workspaceRoot: string,
  graph: RepoGraph,
): boolean {
  const generatedAtMs = Date.parse(graph.generatedAt);
  if (!Number.isFinite(generatedAtMs)) return false;

  for (const node of graph.nodes) {
    if (node.kind !== 'file') continue;
    const absolutePath = join(workspaceRoot, node.relativePath);
    try {
      const info = statSync(absolutePath);
      if (Math.trunc(info.mtimeMs) > generatedAtMs) {
        return true;
      }
    } catch {
      // Indexed file no longer present — graph no longer matches workspace.
      return true;
    }
  }
  return false;
}

function collectGraphRootIds(graph: RepoGraph): string[] {
  const rootIds = new Set<string>();
  for (const node of graph.nodes) {
    if (node.kind === 'file' || node.kind === 'project') {
      rootIds.add(node.rootId);
    }
  }
  return [...rootIds];
}

function readIndexRuntimeGraphMetadata(
  mitiiDir: string,
): IndexRuntimeGraphMetadata | undefined {
  // Prefer the shared reader so metadata shape stays aligned with indexing.
  const full = readIndexRuntimeMetadata(join(mitiiDir, 'index-runtime.json'));
  if (full) {
    return {
      graphArtifactPaths: full.graphArtifactPaths,
      graphRevisionByRoot: full.graphRevisionByRoot,
      snapshotFingerprint: full.snapshotFingerprint,
      generatedAt: full.generatedAt,
    };
  }
  return undefined;
}
