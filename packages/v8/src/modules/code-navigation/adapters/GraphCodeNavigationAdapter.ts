import type {
  RepoGraph,
  RepoGraphFileNode,
  RepoGraphSymbolNode,
} from "../../repository-state";
import {
  CODE_NAVIGATION_OPERATIONS,
} from "../constants";
import { CODE_NAVIGATION_POLICY } from "../policy";
import type {
  CodeNavigationCallOptions,
  CodeNavigationCapability,
  CodeNavigationDocumentQuery,
  CodeNavigationHover,
  CodeNavigationLocation,
  CodeNavigationPort,
  CodeNavigationQuery,
  CodeNavigationWorkspaceQuery,
} from "../contracts";

export interface GraphCodeNavigationAdapterOptions {
  loadGraphs: () =>
    | readonly RepoGraph[]
    | Promise<readonly RepoGraph[]>;
}

export class GraphCodeNavigationAdapter implements CodeNavigationPort {
  public readonly id = "repo-graph-code-navigation";
  public readonly provider = "repo_graph" as const;

  constructor(
    private readonly options: GraphCodeNavigationAdapterOptions,
  ) {}

  public capability(): CodeNavigationCapability {
    return {
      status: "degraded",
      provider: "repo_graph",
      reason: "language_server_not_configured",
      operations: CODE_NAVIGATION_OPERATIONS,
    };
  }

  public async definition(
    input: CodeNavigationQuery,
    _options?: CodeNavigationCallOptions,
  ): Promise<readonly CodeNavigationLocation[]> {
    const symbols = await this.resolveSymbols(input);
    return this.uniqueLocations(
      symbols.map((symbol) => this.toLocation(symbol.file, symbol.node)),
    );
  }

  public async typeDefinition(
    input: CodeNavigationQuery,
    _options?: CodeNavigationCallOptions,
  ): Promise<readonly CodeNavigationLocation[]> {
    // Graph has no typed-expression edges; degrade to the symbol at the caret
    // when it looks type-like, otherwise empty (language server preferred).
    const symbols = await this.resolveSymbols(input);
    const typed = symbols.filter((symbol) =>
      isTypeLikeSymbolKind(symbol.node.symbolKind),
    );
    const chosen = typed.length > 0 ? typed : symbols;
    return this.uniqueLocations(
      chosen.map((symbol) => this.toLocation(symbol.file, symbol.node)),
    );
  }

  public async references(
    input: CodeNavigationQuery,
    _options?: CodeNavigationCallOptions,
  ): Promise<readonly CodeNavigationLocation[]> {
    const graphs = await this.options.loadGraphs();
    const symbols = await this.resolveSymbols(input, graphs);
    const symbolIds = new Set(symbols.map((symbol) => symbol.node.id));
    const locations: CodeNavigationLocation[] = [];

    if (input.includeDeclaration !== false) {
      locations.push(
        ...symbols.map((symbol) => this.toLocation(symbol.file, symbol.node)),
      );
    }

    for (const graph of graphs) {
      const files = fileIndex(graph);
      const nodes = symbolIndex(graph);
      for (const edge of graph.edges) {
        if (
          !CODE_NAVIGATION_POLICY.graphEdgeTypes.includes(
            edge.type as (typeof CODE_NAVIGATION_POLICY.graphEdgeTypes)[number],
          )
        ) {
          continue;
        }
        const relatedId = symbolIds.has(edge.toNodeId)
          ? edge.fromNodeId
          : symbolIds.has(edge.fromNodeId)
            ? edge.toNodeId
            : undefined;
        if (!relatedId) continue;
        const related = nodes.get(relatedId);
        const file = related ? files.get(related.fileId) : undefined;
        if (!related || !file) continue;
        locations.push(this.toLocation(file, related, edge.evidence[0]?.line));
      }
    }

    return this.uniqueLocations(locations);
  }

  public async hover(
    input: CodeNavigationQuery,
    _options?: CodeNavigationCallOptions,
  ): Promise<CodeNavigationHover | undefined> {
    const [symbol] = await this.resolveSymbols(input);
    if (!symbol) return undefined;
    const signature = symbol.node.signature?.trim();
    const contents = signature
      ? signature
      : `${symbol.node.symbolKind} ${symbol.node.name}`;
    return { contents };
  }

  public async documentSymbols(
    input: CodeNavigationDocumentQuery,
    _options?: CodeNavigationCallOptions,
  ): Promise<readonly CodeNavigationLocation[]> {
    const graphs = await this.options.loadGraphs();
    const normalizedPath = normalizeRelativePath(input.relativePath);
    const locations: CodeNavigationLocation[] = [];
    for (const graph of graphs) {
      const files = fileIndex(graph);
      for (const node of graph.nodes) {
        if (node.kind !== "symbol") continue;
        const file = files.get(node.fileId);
        if (!file) continue;
        if (normalizeRelativePath(file.relativePath) !== normalizedPath) continue;
        locations.push(this.toLocation(file, node));
      }
    }
    return this.uniqueLocations(locations);
  }

  public async workspaceSymbols(
    input: CodeNavigationWorkspaceQuery,
    _options?: CodeNavigationCallOptions,
  ): Promise<readonly CodeNavigationLocation[]> {
    const graphs = await this.options.loadGraphs();
    const needle = input.query.trim().toLowerCase();
    const locations: CodeNavigationLocation[] = [];
    for (const graph of graphs) {
      const files = fileIndex(graph);
      for (const node of graph.nodes) {
        if (node.kind !== "symbol") continue;
        if (!node.name.toLowerCase().includes(needle)) continue;
        const file = files.get(node.fileId);
        if (!file) continue;
        locations.push(this.toLocation(file, node));
      }
    }
    return this.uniqueLocations(locations);
  }

  public async implementation(
    input: CodeNavigationQuery,
    _options?: CodeNavigationCallOptions,
  ): Promise<readonly CodeNavigationLocation[]> {
    const graphs = await this.options.loadGraphs();
    const symbols = await this.resolveSymbols(input, graphs);
    let frontier = new Set(symbols.map((symbol) => symbol.node.id));
    const locations: CodeNavigationLocation[] = [];
    const seen = new Set(frontier);

    for (let hop = 0; hop < CODE_NAVIGATION_POLICY.graphHopDepth && frontier.size > 0; hop += 1) {
      const next = new Set<string>();
      for (const graph of graphs) {
        const files = fileIndex(graph);
        const nodes = symbolIndex(graph);
        for (const edge of graph.edges) {
          if (edge.type !== "implements" && edge.type !== "extends") continue;
          if (!frontier.has(edge.toNodeId) || seen.has(edge.fromNodeId)) continue;
          const related = nodes.get(edge.fromNodeId);
          const file = related ? files.get(related.fileId) : undefined;
          if (!related || !file) continue;
          seen.add(edge.fromNodeId);
          next.add(edge.fromNodeId);
          locations.push(this.toLocation(file, related));
        }
      }
      frontier = next;
    }

    return this.uniqueLocations(locations);
  }

  public async callHierarchy(
    input: CodeNavigationQuery,
    _options?: CodeNavigationCallOptions,
  ): Promise<readonly CodeNavigationLocation[]> {
    const graphs = await this.options.loadGraphs();
    const symbols = await this.resolveSymbols(input, graphs);
    const direction = input.direction ?? "outgoing";
    let frontier = new Set(symbols.map((symbol) => symbol.node.id));
    const locations: CodeNavigationLocation[] = [];
    const seen = new Set<string>();

    for (let hop = 0; hop < CODE_NAVIGATION_POLICY.graphHopDepth && frontier.size > 0; hop += 1) {
      const next = new Set<string>();
      for (const graph of graphs) {
        const files = fileIndex(graph);
        const nodes = symbolIndex(graph);
        for (const edge of graph.edges) {
          if (edge.type !== "calls") continue;
          const fromId = direction === "outgoing" ? edge.fromNodeId : edge.toNodeId;
          const toId = direction === "outgoing" ? edge.toNodeId : edge.fromNodeId;
          if (!frontier.has(fromId) || seen.has(toId)) continue;
          const related = nodes.get(toId);
          const file = related ? files.get(related.fileId) : undefined;
          if (!related || !file) continue;
          seen.add(toId);
          next.add(toId);
          locations.push(this.toLocation(file, related));
        }
      }
      frontier = next;
    }

    return this.uniqueLocations(locations);
  }

  private async resolveSymbols(
    input: CodeNavigationQuery,
    graphs?: readonly RepoGraph[],
  ): Promise<
    Array<{ node: RepoGraphSymbolNode; file: RepoGraphFileNode }>
  > {
    const loaded = graphs ?? (await this.options.loadGraphs());
    const normalizedPath = normalizeRelativePath(input.relativePath);
    const matches: Array<{
      node: RepoGraphSymbolNode;
      file: RepoGraphFileNode;
    }> = [];

    for (const graph of loaded) {
      const files = fileIndex(graph);
      for (const node of graph.nodes) {
        if (node.kind !== "symbol") continue;
        const file = files.get(node.fileId);
        if (!file) continue;
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
        if (
          input.symbolName &&
          node.name === input.symbolName
        ) {
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
        // Prefer symbols whose declaration starts on the caret line (name site).
        const leftOnLine = left.node.startLine === input.line ? 0 : 1;
        const rightOnLine = right.node.startLine === input.line ? 0 : 1;
        if (leftOnLine !== rightOnLine) return leftOnLine - rightOnLine;
        // Tighter span wins; with an explicit column, prefer smaller bodies.
        const spanDelta = span(left.node) - span(right.node);
        if (spanDelta !== 0) return spanDelta;
        if (column > 1) {
          // Without symbol columns on the graph, break ties by declaration order.
          return (left.node.startLine ?? 0) - (right.node.startLine ?? 0);
        }
        return 0;
      });
      return [positional[0]!];
    }
    return matches;
  }

  private toLocation(
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

  private uniqueLocations(
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
      if (seen.has(key)) continue;
      seen.add(key);
      result.push(location);
    }
    return result.slice(0, CODE_NAVIGATION_POLICY.maximumLocations);
  }
}

export class FallbackCodeNavigationAdapter implements CodeNavigationPort {
  public readonly id = "fallback-code-navigation";
  /**
   * Reflects the provider that answered the most recent navigation call.
   * Sequential tool-loop use only — not safe across concurrent navigate().
   */
  public provider: "language_server" | "repo_graph";

  constructor(
    private readonly options: {
      primary: CodeNavigationPort;
      fallback: CodeNavigationPort;
    },
  ) {
    this.provider = options.primary.provider;
  }

  public async definition(
    input: CodeNavigationQuery,
    options?: CodeNavigationCallOptions,
  ): Promise<readonly CodeNavigationLocation[]> {
    return this.firstNonEmpty(
      () => this.options.primary.definition(input, options),
      () => this.options.fallback.definition(input, options),
    );
  }

  public async typeDefinition(
    input: CodeNavigationQuery,
    options?: CodeNavigationCallOptions,
  ): Promise<readonly CodeNavigationLocation[]> {
    return this.firstNonEmpty(
      () =>
        this.options.primary.typeDefinition?.(input, options) ??
        Promise.resolve([]),
      () =>
        this.options.fallback.typeDefinition?.(input, options) ??
        Promise.resolve([]),
    );
  }

  public async prepare(
    relativePath: string,
    options?: CodeNavigationCallOptions,
  ): Promise<void> {
    try {
      await this.options.primary.prepare?.(relativePath, options);
    } catch {
      // Primary prepare failure must not block graph fallback.
    }
    await this.options.fallback.prepare?.(relativePath, options);
  }

  public async references(
    input: CodeNavigationQuery,
    options?: CodeNavigationCallOptions,
  ): Promise<readonly CodeNavigationLocation[]> {
    return this.firstNonEmpty(
      () => this.options.primary.references(input, options),
      () => this.options.fallback.references(input, options),
    );
  }

  public async hover(
    input: CodeNavigationQuery,
    options?: CodeNavigationCallOptions,
  ): Promise<CodeNavigationHover | undefined> {
    try {
      const hover = await this.options.primary.hover?.(input, options);
      if (hover) {
        this.provider = this.options.primary.provider;
        return hover;
      }
    } catch {
      // Fall through to graph hover.
    }
    this.provider = this.options.fallback.provider;
    return this.options.fallback.hover?.(input, options);
  }

  public capability(): CodeNavigationCapability {
    return (
      this.options.primary.capability?.() ?? {
        status: "available",
        provider: this.options.primary.provider,
        reason: "language_server_attached",
        operations: CODE_NAVIGATION_OPERATIONS,
      }
    );
  }

  public async documentSymbols(
    input: CodeNavigationDocumentQuery,
    options?: CodeNavigationCallOptions,
  ): Promise<readonly CodeNavigationLocation[]> {
    return this.firstNonEmpty(
      () =>
        this.options.primary.documentSymbols?.(input, options) ??
        Promise.resolve([]),
      () =>
        this.options.fallback.documentSymbols?.(input, options) ??
        Promise.resolve([]),
    );
  }

  public async workspaceSymbols(
    input: CodeNavigationWorkspaceQuery,
    options?: CodeNavigationCallOptions,
  ): Promise<readonly CodeNavigationLocation[]> {
    return this.firstNonEmpty(
      () =>
        this.options.primary.workspaceSymbols?.(input, options) ??
        Promise.resolve([]),
      () =>
        this.options.fallback.workspaceSymbols?.(input, options) ??
        Promise.resolve([]),
    );
  }

  public async implementation(
    input: CodeNavigationQuery,
    options?: CodeNavigationCallOptions,
  ): Promise<readonly CodeNavigationLocation[]> {
    return this.firstNonEmpty(
      () =>
        this.options.primary.implementation?.(input, options) ??
        Promise.resolve([]),
      () =>
        this.options.fallback.implementation?.(input, options) ??
        Promise.resolve([]),
    );
  }

  public async callHierarchy(
    input: CodeNavigationQuery,
    options?: CodeNavigationCallOptions,
  ): Promise<readonly CodeNavigationLocation[]> {
    return this.firstNonEmpty(
      () =>
        this.options.primary.callHierarchy?.(input, options) ??
        Promise.resolve([]),
      () =>
        this.options.fallback.callHierarchy?.(input, options) ??
        Promise.resolve([]),
    );
  }

  private async firstNonEmpty(
    primary: () => Promise<readonly CodeNavigationLocation[]>,
    fallback: () => Promise<readonly CodeNavigationLocation[]>,
  ): Promise<readonly CodeNavigationLocation[]> {
    try {
      const locations = await primary();
      if (locations.length > 0) {
        this.provider = this.options.primary.provider;
        return locations;
      }
    } catch {
      // Language servers can fail closed; graph remains available.
    }
    this.provider = this.options.fallback.provider;
    return fallback();
  }
}

function fileIndex(
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

function symbolIndex(
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

function coversLine(
  symbol: RepoGraphSymbolNode,
  line: number,
): boolean {
  if (!symbol.startLine) return false;
  const end = symbol.endLine ?? symbol.startLine;
  return line >= symbol.startLine && line <= end;
}

function isTypeLikeSymbolKind(kind: string): boolean {
  const normalized = kind.toLowerCase();
  return (
    normalized.includes("class") ||
    normalized.includes("interface") ||
    normalized.includes("enum") ||
    normalized.includes("type") ||
    normalized.includes("struct")
  );
}

function span(symbol: RepoGraphSymbolNode): number {
  if (!symbol.startLine) return Number.MAX_SAFE_INTEGER;
  return (symbol.endLine ?? symbol.startLine) - symbol.startLine;
}

function normalizeRelativePath(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\.\//, "");
}
