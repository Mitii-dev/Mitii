import {
  CONTEXT_ASSEMBLY_IDS,
} from "./constants";

import type {
  ContextBlockIdInput,
} from "./types";

export class ContextBlockIdBuilder {
  public readonly id =
    CONTEXT_ASSEMBLY_IDS
      .BLOCK_BUILDER;

  public build(
    input:
      ContextBlockIdInput,
  ): string {
    const ranges =
      input.lineRanges
        .map(
          (range) =>
            `${range.startLine}-${range.endLine}`,
        )
        .join(",");

    return [
      "context",
      input.sourceId,
      input.rootId ??
        "",
      input.relativePath,
      input.representation,
      ranges,
    ].map(
      (value) =>
        encodeURIComponent(
          value,
        ),
    ).join(":");
  }
}
