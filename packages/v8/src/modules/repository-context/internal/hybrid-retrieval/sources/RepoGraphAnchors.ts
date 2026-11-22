import {
  HYBRID_RETRIEVAL_DEFAULTS,
} from "../constants";

import {
  candidateMatchesScope,
  toGraphCandidate,
} from "./RepoGraphCandidates";

import type {
  RepoGraphAnchorMatch,
  RepoGraphFileIndex,
} from "./RepoGraphCandidates";

import type {
  RepoGraphNode,
} from "../../../../repository-state/index";

import type {
  NormalizedHybridRetrievalRequest,
} from "../types";

/** Collects pinned-file anchors: the pinned files and the symbols they contain. */
export function collectFileAnchors(
  nodes: readonly RepoGraphNode[],
  fileByFileId: RepoGraphFileIndex,
  request: NormalizedHybridRetrievalRequest,
): RepoGraphAnchorMatch[] {
  const anchors = new Set(
    request.anchorFilePaths ?? [],
  );

  if (anchors.size === 0) {
    return [];
  }

  const matches: RepoGraphAnchorMatch[] = [];
  const anchoredFileIds = new Set<string>();

  for (const node of nodes) {
    if (
      node.kind !== "file" ||
      !anchors.has(node.relativePath)
    ) {
      continue;
    }

    const candidate = toGraphCandidate(
      node,
      fileByFileId,
      HYBRID_RETRIEVAL_DEFAULTS
        .GRAPH_FILE_ANCHOR_SCORE,
      {
        type: "graph_file_anchor",
        evidence: `Pinned file prior for ${node.relativePath}.`,
      },
    );

    if (
      !candidate ||
      !candidateMatchesScope(candidate, request)
    ) {
      continue;
    }

    anchoredFileIds.add(node.fileId);
    matches.push({ nodeId: node.id, candidate });
  }

  for (const node of nodes) {
    if (
      node.kind !== "symbol" ||
      !anchoredFileIds.has(node.fileId)
    ) {
      continue;
    }

    const candidate = toGraphCandidate(
      node,
      fileByFileId,
      HYBRID_RETRIEVAL_DEFAULTS
        .GRAPH_FILE_ANCHOR_SCORE,
      {
        type: "graph_file_anchor",
        evidence: `Pinned file prior for ${
          fileByFileId.get(node.fileId)
            ?.relativePath ?? node.name
        }.`,
      },
    );

    if (
      !candidate ||
      !candidateMatchesScope(candidate, request)
    ) {
      continue;
    }

    matches.push({ nodeId: node.id, candidate });
  }

  return matches.sort((left, right) =>
    left.nodeId.localeCompare(right.nodeId),
  );
}

/** Reserves slots for file anchors, then fills the rest with query matches. */
export function mergeAnchorMatches(
  fileAnchors: readonly RepoGraphAnchorMatch[],
  queryMatches: readonly RepoGraphAnchorMatch[],
  maximumAnchorNodes: number,
): RepoGraphAnchorMatch[] {
  const reserved = fileAnchors.slice(
    0,
    maximumAnchorNodes,
  );
  const reservedIds = new Set(
    reserved.map((match) => match.nodeId),
  );
  const remaining =
    maximumAnchorNodes - reserved.length;
  const queryFill = queryMatches
    .filter((match) => !reservedIds.has(match.nodeId))
    .slice(0, remaining);

  return [...reserved, ...queryFill];
}
