import {
  CONTEXT_ASSEMBLY_IDS,
} from "./constants";

import {
  ContextBlockIdBuilder,
} from "./ContextBlockIdBuilder";

import type {
  ContextBlock,
  ContextBlockBuildInput,
} from "./types";

export class ContextBlockBuilder {
  public readonly id =
    CONTEXT_ASSEMBLY_IDS
      .BLOCK_BUILDER;

  public constructor(
    private readonly idBuilder =
      new ContextBlockIdBuilder(),
  ) {}

  public build(
    input:
      ContextBlockBuildInput,
  ): ContextBlock {
    const item =
      input.item;
    const loaded =
      input.loaded;
    const retrievalSourceIds =
      [
        ...new Set(
          item
            .retrievalCandidate
            ?.contributions
            .map(
              (contribution) =>
                contribution
                  .sourceId,
            ) ??
          [],
        ),
      ].sort();
    const id =
      this.idBuilder.build({
        sourceId:
          loaded.sourceId,
        ...(item.rootId
          ? {
              rootId:
                item.rootId,
            }
          : {}),
        relativePath:
          item.relativePath,
        representation:
          loaded
            .representation,
        lineRanges:
          input.lineRanges,
      });

    return {
      id,
      trust:
        "untrusted_repository_content",
      sourceId:
        loaded.sourceId,
      ...(item.rootId
        ? {
            rootId:
              item.rootId,
          }
        : {}),
      relativePath:
        item.relativePath,
      ...(item.chunkId
        ? {
            chunkId:
              item.chunkId,
          }
        : {}),
      ...(item.symbolId
        ? {
            symbolId:
              item.symbolId,
          }
        : {}),
      requestedRepresentation:
        loaded
          .requestedRepresentation,
      representation:
        loaded
          .representation,
      content:
        input.content,
      ...(loaded.contentHash
        ? {
            contentHash:
              loaded
                .contentHash,
          }
        : {}),
      lineRanges:
        input.lineRanges,
      allocatedTokens:
        item.allocatedTokens,
      tokenEstimate:
        input.tokenEstimate,
      truncated:
        input.truncated,
      omittedCharacters:
        input
          .omittedCharacters,
      redactions:
        input.redactions,
      provenance: {
        selectionKey:
          item.key,
        selectionOrder:
          item.selectionOrder,
        origins: [
          ...item.origin,
        ],
        priority:
          item.priority,
        score:
          item.score,
        signals:
          item.signals.map(
            (signal) => ({
              ...signal,
            }),
          ),
        retrievalSourceIds,
      },
    };
  }
}
