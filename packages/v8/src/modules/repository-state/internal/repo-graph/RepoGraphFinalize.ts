import {
  REPO_GRAPH_SCHEMA_VERSION,
} from "./constants";

import {
  repoGraphSchema,
} from "./schema";

import type {
  RepoGraph,
  RepoGraphBuildAttempt,
  RepoGraphBuildInput,
  RepoGraphEdgeType,
  RepoGraphNode,
  RepoGraphStatistics,
} from "./types";

export function finalizeGraph(input: {
  input: RepoGraphBuildInput;
  attempt: RepoGraphBuildAttempt;
  changeToken: string;
  consistencyRetries: number;
  durationMs: number;
  indexChanged: boolean;
}): RepoGraph {
  const warnings = [...input.attempt.warnings];

  if (input.indexChanged) {
    warnings.push({
      code: "code_index_changed_during_build",
      message:
        "The Code Index changed during Repo Graph construction. The returned graph may represent a partial index state.",
    });
  }

  const partial =
    input.attempt.filesTruncated ||
    input.attempt.nodesTruncated ||
    input.attempt.symbolsTruncated ||
    input.attempt.edgesTruncated ||
    input.indexChanged;

  const graph: RepoGraph = {
    schemaVersion: REPO_GRAPH_SCHEMA_VERSION,

    workspaceSnapshotId:
      input.input.snapshot.snapshotId,

    codeIndexChangeToken: input.changeToken,

    nodes: input.attempt.nodes,

    edges: input.attempt.edges,

    warnings,

    statistics: buildStatistics(
      input.attempt,
      input.consistencyRetries,
      input.durationMs,
    ),

    status: partial ? "partial" : "complete",

    generatedAt: new Date().toISOString(),
  };

  return repoGraphSchema.parse(graph) as RepoGraph;
}

export function buildStatistics(
  attempt: RepoGraphBuildAttempt,
  consistencyRetries: number,
  durationMs: number,
): RepoGraphStatistics {
  const countNodes = (
    kind: RepoGraphNode["kind"],
  ): number =>
    attempt.nodes.filter((node) => node.kind === kind)
      .length;

  const countEdges = (
    ...types: RepoGraphEdgeType[]
  ): number => {
    const accepted = new Set(types);

    return attempt.edges.filter((edge) =>
      accepted.has(edge.type),
    ).length;
  };

  return {
    availableFiles: attempt.availableFiles,
    indexedFiles: attempt.indexedFiles,
    projectNodes: countNodes("project"),
    fileNodes: countNodes("file"),
    symbolNodes: countNodes("symbol"),
    containsEdges: countEdges("contains"),
    declaresEdges: countEdges("declares"),
    importEdges: countEdges("imports"),
    callEdges: countEdges("calls"),
    referenceEdges: countEdges("references"),
    heritageEdges: countEdges("extends", "implements"),
    projectRelationshipEdges: countEdges(
      "workspace_member",
      "depends_on",
      "development_depends_on",
    ),
    unresolvedImports: attempt.unresolvedImports,
    omittedImportTargets:
      attempt.omittedImportTargets,
    ambiguousReferences: attempt.ambiguousReferences,
    unresolvedReferences:
      attempt.unresolvedReferences,
    omittedReferenceTargets:
      attempt.omittedReferenceTargets,
    omittedParentSymbolTargets:
      attempt.omittedParentSymbolTargets,
    truncatedSymbolFiles:
      attempt.truncatedSymbolFiles,
    droppedSymbolNodes: attempt.droppedSymbolNodes,
    droppedEdges: attempt.droppedEdges,
    consistencyRetries,
    durationMs: Math.max(0, durationMs),
  };
}
