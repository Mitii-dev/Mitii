import {
  RetrievalCandidateKeyBuilder,
} from "../RetrievalCandidateKeyBuilder";

import {
  clampScore,
} from "./RepoGraphScoring";

import type {
  RepoGraphFileNode,
  RepoGraphNode,
  RepoGraphSymbolNode,
} from "../../../../repository-state/index";

import type {
  NormalizedHybridRetrievalRequest,
  RetrievalCandidate,
  RetrievalReason,
} from "../types";

export type RepoGraphFileIndex =
  ReadonlyMap<string, RepoGraphFileNode>;

export interface RepoGraphAnchorMatch {
  readonly nodeId: string;
  readonly candidate: RetrievalCandidate;
}

/** Converts a graph node into a retrieval candidate, or null when not representable. */
export function toGraphCandidate(
  node: RepoGraphNode,
  fileByFileId: RepoGraphFileIndex,
  score: number,
  reason: RetrievalReason,
): RetrievalCandidate | null {
  if (node.kind === "project") {
    return null;
  }

  if (node.kind === "file") {
    return {
      entityKind: "file",
      rootId: node.rootId,
      relativePath: node.relativePath,
      ...(node.contentHash
        ? { contentHash: node.contentHash }
        : {}),
      sourceScore: clampScore(score),
      reasons: [reason],
    };
  }

  return toSymbolCandidate(
    node,
    fileByFileId,
    score,
    reason,
  );
}

function toSymbolCandidate(
  node: RepoGraphSymbolNode,
  fileByFileId: RepoGraphFileIndex,
  score: number,
  reason: RetrievalReason,
): RetrievalCandidate | null {
  const file = fileByFileId.get(node.fileId);

  if (!file) {
    return null;
  }

  return {
    entityKind: "symbol",
    rootId: file.rootId,
    relativePath: file.relativePath,
    symbolId: node.symbolId,
    ...(node.startLine !== undefined
      ? { startLine: node.startLine }
      : {}),
    ...(node.endLine !== undefined
      ? { endLine: node.endLine }
      : {}),
    title: node.name,
    ...(file.contentHash
      ? { contentHash: file.contentHash }
      : {}),
    sourceScore: clampScore(score),
    reasons: [reason],
  };
}

/** Inserts a candidate, merging reasons and keeping the higher score on key collision. */
export function addGraphCandidate(
  candidates: Map<string, RetrievalCandidate>,
  candidate: RetrievalCandidate,
  keyBuilder: RetrievalCandidateKeyBuilder,
): void {
  const key = keyBuilder.build(candidate);
  const existing = candidates.get(key);

  if (!existing) {
    candidates.set(key, candidate);
    return;
  }

  const reasons = new Map(
    [
      ...existing.reasons,
      ...candidate.reasons,
    ].map((reason) => [
      `${reason.type}\u0000${reason.evidence}`,
      reason,
    ]),
  );

  candidates.set(key, {
    ...(candidate.sourceScore >
    existing.sourceScore
      ? candidate
      : existing),
    sourceScore: Math.max(
      candidate.sourceScore,
      existing.sourceScore,
    ),
    reasons: [...reasons.values()],
  });
}

/** True when the candidate satisfies the request root and file scope filters. */
export function candidateMatchesScope(
  candidate: RetrievalCandidate,
  request: NormalizedHybridRetrievalRequest,
): boolean {
  if (
    request.rootIds.length > 0 &&
    !request.rootIds.includes(candidate.rootId)
  ) {
    return false;
  }

  return matchesFileScope(
    candidate.relativePath,
    request,
  );
}

function matchesFileScope(
  relativePath: string,
  request: NormalizedHybridRetrievalRequest,
): boolean {
  if (
    request.filePaths.length === 0 &&
    !request.folderPrefix
  ) {
    return true;
  }

  if (request.filePaths.includes(relativePath)) {
    return true;
  }

  return Boolean(
    request.folderPrefix &&
      (relativePath === request.folderPrefix ||
        relativePath.startsWith(
          `${request.folderPrefix}/`,
        )),
  );
}
