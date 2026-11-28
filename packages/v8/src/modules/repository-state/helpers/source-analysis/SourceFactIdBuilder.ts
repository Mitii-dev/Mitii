import {
  SOURCE_ANALYSIS_IDS,
} from "./constants";

import type {
  SourceSymbolLocalIdInput,
} from "./types";

export class SourceFactIdBuilder {
  public createSymbolLocalId(
    input:
      SourceSymbolLocalIdInput,
  ): string {
    const kind = input.kind.trim();
    const name = input.name.trim();

    if (
      !kind ||
      !name ||
      !Number.isSafeInteger(
        input.startLine,
      ) ||
      input.startLine <= 0
    ) {
      throw new RangeError(
        "Local symbol IDs require kind, name, and a positive startLine.",
      );
    }

    const ordinal =
      input.ordinal ?? 0;

    if (
      !Number.isSafeInteger(ordinal) ||
      ordinal < 0
    ) {
      throw new RangeError(
        "Symbol ordinal must be a non-negative safe integer.",
      );
    }

    return [
      SOURCE_ANALYSIS_IDS
        .SYMBOL_PREFIX,
      encodeURIComponent(kind),
      encodeURIComponent(name),
      String(input.startLine),
      String(ordinal),
    ].join(":");
  }
}

