import type { RepoGraphSymbolNode } from "../../repository-state";

/**
 * Soft symbol resolution when an exact seed match fails (Continue-style
 * fallback before exploding to file-level impact).
 */
export function resolveSoftSymbolMatches(params: {
  symbolsInFile: readonly RepoGraphSymbolNode[];
  symbolName?: string;
  /** Preferred caret line when present. */
  line?: number;
  /** Host text-search / occurrence hints (1-based lines). */
  textOccurrenceLines?: readonly number[];
}): RepoGraphSymbolNode[] {
  const name = params.symbolName?.trim();
  const byName =
    name && name.length > 0
      ? params.symbolsInFile.filter((node) => softNameMatch(node.name, name))
      : [];

  if (byName.length === 1) {
    return byName;
  }

  if (byName.length > 1) {
    if (params.line !== undefined) {
      const covering = byName.filter((node) => coversLine(node, params.line!));
      if (covering.length > 0) {
        return pickNearestEnclosing(covering);
      }
    }
    if (params.textOccurrenceLines && params.textOccurrenceLines.length > 0) {
      const fromHints = byName.filter((node) =>
        params.textOccurrenceLines!.some((line) => coversLine(node, line)),
      );
      if (fromHints.length > 0) {
        return pickNearestEnclosing(fromHints);
      }
    }
    return pickNearestEnclosing(byName);
  }

  // No name match: try hint lines alone (caret-like covering symbols).
  if (params.textOccurrenceLines && params.textOccurrenceLines.length > 0) {
    const covering = params.symbolsInFile.filter((node) =>
      params.textOccurrenceLines!.some((line) => coversLine(node, line)),
    );
    if (covering.length > 0) {
      return pickNearestEnclosing(covering);
    }
  }

  return [];
}

function softNameMatch(symbolName: string, seedName: string): boolean {
  if (symbolName === seedName) return true;
  if (symbolName.toLowerCase() === seedName.toLowerCase()) return true;
  // Qualified / nested: Foo.bar or Foo::bar
  if (
    symbolName.endsWith(`.${seedName}`) ||
    symbolName.endsWith(`::${seedName}`)
  ) {
    return true;
  }
  return false;
}

function coversLine(node: RepoGraphSymbolNode, line: number): boolean {
  const start = node.startLine ?? 1;
  const end = node.endLine ?? start;
  return line >= start && line <= end;
}

function pickNearestEnclosing(
  symbols: readonly RepoGraphSymbolNode[],
): RepoGraphSymbolNode[] {
  return [...symbols]
    .sort((left, right) => {
      const startDelta = (right.startLine ?? 1) - (left.startLine ?? 1);
      if (startDelta !== 0) return startDelta;
      const leftSpan =
        (left.endLine ?? left.startLine ?? 1) - (left.startLine ?? 1);
      const rightSpan =
        (right.endLine ?? right.startLine ?? 1) - (right.startLine ?? 1);
      return leftSpan - rightSpan;
    })
    .slice(0, 1);
}
