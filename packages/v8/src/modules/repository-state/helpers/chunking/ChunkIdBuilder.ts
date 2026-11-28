import {
  CHUNKING_IDS,
} from "./constants";

import type {
  ChunkContentHasher,
  ChunkIdInput,
} from "./types";

export class ChunkIdBuilder {
  constructor(
    private readonly hasher:
      ChunkContentHasher,
  ) {}

  public build(
    input: ChunkIdInput,
  ): string {
    const identity = [
      input.sourceId,
      input.rootId,
      input.relativePath,
      input.sourceContentHash,
      input.strategyId,
      input.kind,
      input.startOffset,
      input.endOffset,
      input.contentHash,
    ].join("\u0000");

    return [
      CHUNKING_IDS.CHUNK_PREFIX,
      this.hasher.hash(identity),
    ].join(":");
  }
}

