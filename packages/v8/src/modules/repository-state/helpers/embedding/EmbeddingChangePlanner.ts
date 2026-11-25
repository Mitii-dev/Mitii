import {
  EMBEDDING_IDS,
} from "./constants";

import {
  embeddingChangePlanSchema,
} from "./schema";

import type {
  EmbeddingChangePlan,
  EmbeddingChangePlannerInput,
} from "./types";

export class EmbeddingChangePlanner {
  public readonly id =
    EMBEDDING_IDS
      .CHANGE_PLANNER;

  public plan(
    input:
      EmbeddingChangePlannerInput,
  ): EmbeddingChangePlan {
    const ordered =
      [...input.changes]
        .sort(
          (left, right) =>
            left.revision -
              right.revision ||
            left.chunkId
              .localeCompare(
                right.chunkId,
              ) ||
            left.kind
              .localeCompare(
                right.kind,
              ),
        );

    const latestByChunk =
      new Map<
        string,
        "upsert" | "delete"
      >();

    let nextTextRevision =
      input.currentTextRevision;

    for (
      const change of ordered
    ) {
      if (
        change.revision <=
        input
          .currentTextRevision
      ) {
        continue;
      }

      latestByChunk.set(
        change.chunkId,
        change.kind,
      );

      nextTextRevision =
        Math.max(
          nextTextRevision,
          change.revision,
        );
    }

    const upsertChunkIds:
      string[] = [];
    const deleteChunkIds:
      string[] = [];

    for (
      const [
        chunkId,
        kind,
      ] of latestByChunk
    ) {
      if (kind === "upsert") {
        upsertChunkIds.push(
          chunkId,
        );
      } else {
        deleteChunkIds.push(
          chunkId,
        );
      }
    }

    upsertChunkIds.sort();
    deleteChunkIds.sort();

    return embeddingChangePlanSchema
      .parse({
        upsertChunkIds,
        deleteChunkIds,
        nextTextRevision,
      }) as
      EmbeddingChangePlan;
  }
}
