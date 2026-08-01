import {
  HYBRID_RETRIEVAL_IDS,
} from "./constants";

import type {
  RetrievalCandidate,
} from "./types";

export class RetrievalCandidateKeyBuilder {
  public readonly id =
    HYBRID_RETRIEVAL_IDS
      .CANDIDATE_KEY_BUILDER;

  public build(
    candidate:
      RetrievalCandidate,
  ): string {
    switch (
      candidate.entityKind
    ) {
      case "chunk":
        return this.compose(
          "chunk",
          candidate.rootId,
          candidate.chunkId ??
            candidate.relativePath,
        );

      case "symbol":
        return this.compose(
          "symbol",
          candidate.rootId,
          candidate.symbolId ??
            candidate.relativePath,
        );

      case "file":
      default:
        return this.compose(
          "file",
          candidate.rootId,
          candidate.relativePath,
        );
    }
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
