import type { SourceAnalysisSymbol } from "../../source-analysis/types";
import type { RawChunkSpan } from "../types";

export interface RangedSymbol {
  symbol: SourceAnalysisSymbol;
  startOffset: number;
  endOffset: number;
}

export function fillGaps(
  symbolSpans: readonly RawChunkSpan[],
  contentLength: number,
): RawChunkSpan[] {
  const result:
    RawChunkSpan[] = [];

  let cursor = 0;

  for (
    const span of symbolSpans
  ) {
    if (
      span.startOffset > cursor
    ) {
      result.push({
        startOffset: cursor,
        endOffset:
          span.startOffset,
        kind: "code_region",
      });
    }

    result.push(span);

    cursor = Math.max(
      cursor,
      span.endOffset,
    );
  }

  if (cursor < contentLength) {
    result.push({
      startOffset: cursor,
      endOffset:
        contentLength,
      kind: "code_region",
    });
  }

  return result;
}

export function removeOverlappingSymbols(
  symbols: readonly RangedSymbol[],
): RangedSymbol[] {
  const result: RangedSymbol[] = [];
  let lastEnd = -1;

  for (const symbol of symbols) {
    if (symbol.startOffset < lastEnd) {
      continue;
    }

    result.push(symbol);
    lastEnd = symbol.endOffset;
  }

  return result;
}

export function sortByRange(
  symbols: readonly RangedSymbol[],
): RangedSymbol[] {
  return [...symbols].sort(
    (left, right) =>
      left.startOffset - right.startOffset ||
      right.endOffset - left.endOffset ||
      left.symbol.localId.localeCompare(
        right.symbol.localId,
      ),
  );
}

export function sortSpans(
  spans: readonly RawChunkSpan[],
): RawChunkSpan[] {
  return [...spans].sort(
    (left, right) =>
      left.startOffset - right.startOffset ||
      right.endOffset - left.endOffset ||
      left.kind.localeCompare(right.kind) ||
      (left.symbolLocalId ?? "").localeCompare(
        right.symbolLocalId ?? "",
      ),
  );
}

export function collectLineStarts(
  content: string,
): number[] {
  const starts = [0];

  for (
    let index = 0;
    index < content.length;
    index += 1
  ) {
    if (
      content[index] ===
        "\n" &&
      index + 1 <
        content.length
    ) {
      starts.push(index + 1);
    }
  }

  return starts;
}

export function extensionOf(
  relativePath: string,
): string {
  const normalized =
    relativePath
      .replace(/\\/g, "/")
      .toLowerCase();

  const basename =
    normalized.split("/")
      .pop() ?? normalized;

  const dot =
    basename.lastIndexOf(".");

  return dot >= 0
    ? basename.slice(dot)
    : "";
}
