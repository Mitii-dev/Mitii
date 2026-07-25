import {
  CONTEXT_SELECTION_IDS,
} from "./constants";

import type {
  ContextFileReference,
} from "./types";

export class ContextReferenceKeyBuilder {
  public readonly id =
    CONTEXT_SELECTION_IDS
      .REFERENCE_KEY_BUILDER;

  public buildFileKey(
    reference:
      ContextFileReference,
  ): string {
    return this.join([
      "file",
      reference.rootId ?? "",
      reference.relativePath,
    ]);
  }

  public buildRangeKey(
    reference:
      ContextFileReference,
    startLine: number,
    endLine: number,
  ): string {
    return this.join([
      "range",
      reference.rootId ?? "",
      reference.relativePath,
      String(startLine),
      String(endLine),
    ]);
  }

  private join(
    parts: readonly string[],
  ): string {
    return parts
      .map(
        (part) =>
          `${part.length}:${part}`,
      )
      .join("|");
  }
}
