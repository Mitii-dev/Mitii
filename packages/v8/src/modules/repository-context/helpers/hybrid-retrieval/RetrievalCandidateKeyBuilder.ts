import {
  HYBRID_RETRIEVAL_IDS,
} from "./constants";

import type {
  RetrievalCandidate,
} from "./types";

/**
 * Builds fusion identity keys. When line spans are present, keys include the
 * span so overlapping exact ranges from different sources reinforce (Cody-style
 * line-identity RRF, simplified to start–end rather than per-line expansion).
 */
export class RetrievalCandidateKeyBuilder {
  public readonly id =
    HYBRID_RETRIEVAL_IDS
      .CANDIDATE_KEY_BUILDER;

  public build(
    candidate:
      RetrievalCandidate,
  ): string {
    const spanSuffix =
      this.spanSuffix(candidate);

    switch (
      candidate.entityKind
    ) {
      case "chunk":
        return this.compose(
          "chunk",
          candidate.rootId,
          candidate.chunkId ??
            candidate.relativePath,
          ...spanSuffix,
        );

      case "symbol":
        return this.compose(
          "symbol",
          candidate.rootId,
          candidate.symbolId ??
            candidate.relativePath,
          ...spanSuffix,
        );

      case "file":
      default:
        return this.compose(
          "file",
          candidate.rootId,
          candidate.relativePath,
          ...spanSuffix,
        );
    }
  }

  private spanSuffix(
    candidate: RetrievalCandidate,
  ): string[] {
    if (
      candidate.startLine === undefined ||
      candidate.endLine === undefined ||
      !Number.isSafeInteger(candidate.startLine) ||
      !Number.isSafeInteger(candidate.endLine) ||
      candidate.startLine < 1 ||
      candidate.endLine < candidate.startLine
    ) {
      return [];
    }

    return [
      `L${candidate.startLine}-${candidate.endLine}`,
    ];
  }

  private compose(
    ...parts: readonly string[]
  ): string {
    return parts
      .map(
        (part) =>
          `${part.length}:${part}`,
      )
      .join("|");
  }
}
