import type {
  RepoGraph,
  RepoGraphFileNode,
  RepoGraphSymbolNode,
} from "../../../repository-state";
import { CODE_NAVIGATION_POLICY } from "../../rules";
import type {
  CodeNavigationLocation,
  CodeNavigationQuery,
} from "../../contracts";

export type GraphLoadGraphs = () =>
  | readonly RepoGraph[]
  | Promise<readonly RepoGraph[]>;

export type ResolvedGraphSymbol = {
  node: RepoGraphSymbolNode;
  file: RepoGraphFileNode;
};

export async function resolveSymbols(
  loadGraphs: GraphLoadGraphs,
  input: CodeNavigationQuery,
  graphs?: readonly RepoGraph[],
): Promise<ResolvedGraphSymbol[]> {
  const loaded = graphs ?? (await loadGraphs());
  const normalizedPath = normalizeRelativePath(input.relativePath);
  const matches: ResolvedGraphSymbol[] = [];

  for (const graph of loaded) {
    const files = fileIndex(graph);
    for (const node of graph.nodes) {
      if (node.kind !== "symbol") {
        continue;
      }
      const file = files.get(node.fileId);
      if (!file) {
        continue;
      }
      if (
        normalizeRelativePath(file.relativePath) !== normalizedPath &&
        !input.symbolName
      ) {
        continue;
      }
      if (
        input.symbolName &&
        node.name !== input.symbolName &&
        normalizeRelativePath(file.relativePath) !== normalizedPath
      ) {
        continue;
      }
      if (
        normalizeRelativePath(file.relativePath) === normalizedPath &&
        coversLine(node, input.line)
      ) {
        matches.push({ node, file });
        continue;
      }
      if (input.symbolName && node.name === input.symbolName) {
        matches.push({ node, file });
      }
    }
  }

  const positional = matches.filter(
    (match) =>
      normalizeRelativePath(match.file.relativePath) === normalizedPath &&
      coversLine(match.node, input.line),
  );
  if (positional.length > 0) {
    const column = input.column ?? 1;
    positional.sort((left, right) => {
      const leftOnLine = left.node.startLine === input.line ? 0 : 1;
      const rightOnLine = right.node.startLine === input.line ? 0 : 1;
      if (leftOnLine !== rightOnLine) {
        return leftOnLine - rightOnLine;
      }
      const spanDelta = span(left.node) - span(right.node);
      if (spanDelta !== 0) {
        return spanDelta;
      }
      if (column > 1) {
        return (left.node.startLine ?? 0) - (right.node.startLine ?? 0);
      }
      return 0;
    });
    return [positional[0]!];
  }
  return matches;
}

export function toLocation(
  file: RepoGraphFileNode,
  symbol: RepoGraphSymbolNode,
  line = symbol.startLine,
): CodeNavigationLocation {
  return {
    rootId: file.rootId,
    relativePath: file.relativePath,
    startLine: line ?? symbol.startLine ?? 1,
    ...(symbol.endLine ? { endLine: symbol.endLine } : {}),
    symbolName: symbol.name,
    symbolKind: symbol.symbolKind,
    ...(symbol.signature ? { preview: symbol.signature } : {}),
  };
}

export function uniqueLocations(
  locations: readonly CodeNavigationLocation[],
): CodeNavigationLocation[] {
  const seen = new Set<string>();
  const result: CodeNavigationLocation[] = [];
  for (const location of locations) {
    const key = [
      location.rootId ?? "",
      location.relativePath,
      String(location.startLine),
      location.symbolName ?? "",
    ].join("\0");
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(location);
  }
  return result.slice(0, CODE_NAVIGATION_POLICY.maximumLocations);
}

export function fileIndex(
  graph: RepoGraph,
): Map<string, RepoGraphFileNode> {
  const files = new Map<string, RepoGraphFileNode>();
  for (const node of graph.nodes) {
    if (node.kind === "file") {
      files.set(node.fileId, node);
    }
  }
  return files;
}

export function symbolIndex(
  graph: RepoGraph,
): Map<string, RepoGraphSymbolNode> {
  const symbols = new Map<string, RepoGraphSymbolNode>();
  for (const node of graph.nodes) {
    if (node.kind === "symbol") {
      symbols.set(node.id, node);
    }
  }
  return symbols;
}

export function isTypeLikeSymbolKind(kind: string): boolean {
  const normalized = kind.toLowerCase();
  return (
    normalized.includes("class") ||
    normalized.includes("interface") ||
    normalized.includes("enum") ||
    normalized.includes("type") ||
    normalized.includes("struct")
  );
}

export function normalizeRelativePath(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\.\//, "");
}

function coversLine(symbol: RepoGraphSymbolNode, line: number): boolean {
  if (!symbol.startLine) {
    return false;
  }
  const end = symbol.endLine ?? symbol.startLine;
  return line >= symbol.startLine && line <= end;
}

function span(symbol: RepoGraphSymbolNode): number {
  if (!symbol.startLine) {
    return Number.MAX_SAFE_INTEGER;
  }
  return (symbol.endLine ?? symbol.startLine) - symbol.startLine;
}
