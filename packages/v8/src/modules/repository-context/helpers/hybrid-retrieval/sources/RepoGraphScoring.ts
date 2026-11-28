import {
  HYBRID_RETRIEVAL_DEFAULTS,
} from "../constants";

import type {
  RepoGraphEdge,
  RepoGraphEdgeType,
  RepoGraphNode,
} from "../../../../repository-state/index";

import type {
  RetrievalReason,
} from "../types";

/** Clamps a source score into the inclusive 0..1 range. */
export function clampScore(
  value: number,
): number {
  return Math.max(0, Math.min(1, value));
}

/** Scores a graph node against the lower-cased query and its tokens. */
export function scoreGraphNode(
  node: RepoGraphNode,
  queryLower: string,
  tokens: readonly string[],
): number {
  if (node.kind === "project") {
    return 0;
  }

  if (node.kind === "symbol") {
    const name = node.name.toLowerCase();

    if (tokens.includes(name)) {
      return HYBRID_RETRIEVAL_DEFAULTS
        .GRAPH_EXACT_SYMBOL_SCORE;
    }

    if (
      name.length >=
        HYBRID_RETRIEVAL_DEFAULTS
          .MINIMUM_QUERY_TOKEN_CHARACTERS &&
      queryLower.includes(name)
    ) {
      return HYBRID_RETRIEVAL_DEFAULTS
        .GRAPH_SYMBOL_SUBSTRING_SCORE;
    }

    return 0;
  }

  const relativePath =
    node.relativePath.toLowerCase();

  if (queryLower.includes(relativePath)) {
    return HYBRID_RETRIEVAL_DEFAULTS
      .GRAPH_EXACT_PATH_SCORE;
  }

  const baseName =
    relativePath.split("/").at(-1) ??
    relativePath;
  const extensionIndex =
    baseName.lastIndexOf(".");
  const extension =
    extensionIndex > 0
      ? baseName.slice(extensionIndex)
      : "";
  const stem = baseName.slice(
    0,
    baseName.length - extension.length,
  );

  if (
    tokens.includes(baseName) ||
    tokens.includes(stem)
  ) {
    return HYBRID_RETRIEVAL_DEFAULTS
      .GRAPH_FILE_NAME_SCORE;
  }

  if (
    tokens.some((token) =>
      relativePath.includes(token),
    )
  ) {
    return HYBRID_RETRIEVAL_DEFAULTS
      .GRAPH_PATH_TOKEN_SCORE;
  }

  return 0;
}

/** Explains why a graph node matched the query directly. */
export function describeDirectMatch(
  node: RepoGraphNode,
): RetrievalReason {
  if (node.kind === "symbol") {
    return {
      type: "graph_symbol_match",
      evidence: `Graph symbol match for ${node.name}.`,
    };
  }

  if (node.kind === "project") {
    return {
      type: "graph_path_match",
      evidence: `Graph project match for ${node.name}.`,
    };
  }

  return {
    type: "graph_path_match",
    evidence: `Graph path match for ${node.relativePath}.`,
  };
}

/** Explains why a node was reached through a graph edge. */
export function describeNeighborMatch(
  edge: RepoGraphEdge,
  hop: number,
): RetrievalReason {
  return {
    type: neighborReasonType(edge.type),
    evidence:
      `${edge.type} relationship from graph edge ${edge.id} at hop ${hop}.`,
  };
}

function neighborReasonType(
  edgeType: RepoGraphEdgeType,
): RetrievalReason["type"] {
  if (edgeType === "calls") {
    return "graph_call_neighbor";
  }

  if (edgeType === "imports") {
    return "graph_import_neighbor";
  }

  return "graph_reference_neighbor";
}

/** Decays the anchor score by hop distance, with a configured floor. */
export function scoreNeighbor(
  anchorScore: number,
  hop: number,
): number {
  return Math.max(
    HYBRID_RETRIEVAL_DEFAULTS
      .GRAPH_MINIMUM_NEIGHBOR_SCORE,
    anchorScore *
      HYBRID_RETRIEVAL_DEFAULTS
        .GRAPH_NEIGHBOR_SCORE_FACTOR **
        hop,
  );
}
