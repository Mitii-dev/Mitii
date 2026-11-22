import {
  REPO_MAP_DEFAULTS,
  REPO_MAP_SCORE_WEIGHTS,
  REPO_MAP_SYMBOL_KIND_PRIORITY,
} from "../constants";

import type {
  RepoGraph,
  RepoGraphSymbolNode,
} from "../../repo-graph";

import type {
  PageRankEdge,
  RepoMapRankingContext,
  RepoMapSymbol,
} from "../types";

import {
  matchesAnySelection,
  matchesSelection,
  tokenize,
} from "./repoMapFileScoring";

import {
  toRepoMapFile,
} from "./repoMapRankingHelpers";

export interface RepoMapGraphSignals {
  inboundImports:
    ReadonlyMap<string, number>;
  outboundImports:
    ReadonlyMap<string, number>;
  inboundReferences:
    ReadonlyMap<string, number>;
  outboundReferences:
    ReadonlyMap<string, number>;
  pageRankEdges: PageRankEdge[];
}

export function collectSymbols(
  nodes: readonly RepoGraphSymbolNode[],
  fileIds: ReadonlySet<string>,
  maximumSymbolsPerFile: number,
): ReadonlyMap<string, RepoMapSymbol[]> {
  const result =
    new Map<string, RepoMapSymbol[]>();

  for (const fileId of fileIds) {
    result.set(fileId, []);
  }

  for (const node of nodes) {
    const symbols =
      result.get(node.fileId);

    if (!symbols) {
      continue;
    }

    symbols.push({
      id: node.id,
      fileId: node.fileId,
      name: node.name,
      kind: node.symbolKind,

      ...(node.parentSymbolId
        ? {
            parentSymbolId:
              node.parentSymbolId,
          }
        : {}),

      ...(node.exported !== undefined
        ? { exported: node.exported }
        : {}),

      ...(node.signature
        ? { signature: node.signature }
        : {}),

      ...(node.startLine !== undefined
        ? { startLine: node.startLine }
        : {}),

      ...(node.endLine !== undefined
        ? { endLine: node.endLine }
        : {}),
    });
  }

  for (const symbols of result.values()) {
    symbols.sort(
      (left, right) =>
        (REPO_MAP_SYMBOL_KIND_PRIORITY[
          right.kind
        ] ?? 0) -
          (REPO_MAP_SYMBOL_KIND_PRIORITY[
            left.kind
          ] ?? 0) ||
        (left.startLine ?? 0) -
          (right.startLine ?? 0) ||
        left.name.localeCompare(
          right.name,
        ),
    );

    symbols.splice(
      maximumSymbolsPerFile,
    );
  }

  return result;
}

export function collectGraphSignals(
  graph: RepoGraph,
  fileIds: ReadonlySet<string>,
  nodeToFileId: ReadonlyMap<string, string>,
  context: RepoMapRankingContext,
): RepoMapGraphSignals {
  const inboundImports =
    new Map<string, number>();
  const outboundImports =
    new Map<string, number>();
  const inboundReferences =
    new Map<string, number>();
  const outboundReferences =
    new Map<string, number>();
  const pageRankEdges: PageRankEdge[] = [];

  const symbolById = new Map<
    string,
    { name: string; fileId: string }
  >();
  const definerCountByName =
    new Map<string, number>();

  for (const node of graph.nodes) {
    if (node.kind !== "symbol") {
      continue;
    }
    symbolById.set(node.id, {
      name: node.name,
      fileId: node.fileId,
    });
    definerCountByName.set(
      node.name,
      (definerCountByName.get(
        node.name,
      ) ?? 0) + 1,
    );
  }

  const mentionedIdents =
    collectMentionedIdents(context);
  const chatFileIds =
    collectChatFileIds(
      graph,
      fileIds,
      context,
    );

  for (const edge of graph.edges) {
    if (
      edge.type !== "imports" &&
      edge.type !== "calls" &&
      edge.type !== "references"
    ) {
      continue;
    }

    const fromFileId =
      nodeToFileId.get(
        edge.fromNodeId,
      );

    const toFileId =
      nodeToFileId.get(
        edge.toNodeId,
      );

    if (
      !fromFileId ||
      !toFileId ||
      !fileIds.has(fromFileId) ||
      !fileIds.has(toFileId)
    ) {
      continue;
    }

    const count = Math.max(
      1,
      edge.weight,
    );

    if (edge.type === "imports") {
      increment(
        outboundImports,
        fromFileId,
        count,
      );

      increment(
        inboundImports,
        toFileId,
        count,
      );

      if (fromFileId !== toFileId) {
        pageRankEdges.push({
          from: fromFileId,
          to: toFileId,
          weight:
            count *
            REPO_MAP_SCORE_WEIGHTS
              .IMPORT_EDGE,
        });
      }

      continue;
    }

    increment(
      outboundReferences,
      fromFileId,
      count,
    );

    increment(
      inboundReferences,
      toFileId,
      count,
    );

    if (fromFileId !== toFileId) {
      const typeWeight =
        edge.type === "calls"
          ? REPO_MAP_SCORE_WEIGHTS
              .CALL_EDGE
          : REPO_MAP_SCORE_WEIGHTS
              .REFERENCE_EDGE;

      const definer =
        symbolById.get(
          edge.toNodeId,
        );
      const ident =
        definer?.name ?? "";
      const identMul =
        identifierEdgeMultiplier(
          ident,
          mentionedIdents,
          definerCountByName.get(
            ident,
          ) ?? 1,
        );
      const chatMul =
        chatFileIds.has(fromFileId)
          ? REPO_MAP_SCORE_WEIGHTS
              .CHAT_FILE_REFERRER_MULTIPLIER
          : 1;

      pageRankEdges.push({
        from: fromFileId,
        to: toFileId,
        weight:
          Math.sqrt(count) *
          typeWeight *
          identMul *
          chatMul,
      });
    }
  }

  return {
    inboundImports,
    outboundImports,
    inboundReferences,
    outboundReferences,
    pageRankEdges,
  };
}

export function collectMentionedIdents(
  context: RepoMapRankingContext,
): Set<string> {
  const idents = new Set<string>();
  for (const term of tokenize(
    context.query,
  )) {
    if (
      term.length >=
      REPO_MAP_DEFAULTS
        .MINIMUM_QUERY_TERM_LENGTH
    ) {
      idents.add(term);
    }
  }

  const pathSelections = [
    context.currentFile,
    ...(context.openFiles ?? []),
    ...(context.gitDiffFiles ?? []),
  ];
  for (const selection of pathSelections) {
    if (!selection) continue;
    const relativePath =
      typeof selection === "string"
        ? selection
        : selection.relativePath;
    for (const part of relativePath
      .toLowerCase()
      .split(/[/._-]+/)) {
      if (
        part.length >=
        REPO_MAP_DEFAULTS
          .MINIMUM_QUERY_TERM_LENGTH
      ) {
        idents.add(part);
      }
    }
  }

  return idents;
}

export function collectChatFileIds(
  graph: RepoGraph,
  fileIds: ReadonlySet<string>,
  context: RepoMapRankingContext,
): Set<string> {
  const chatIds = new Set<string>();
  for (const node of graph.nodes) {
    if (
      node.kind !== "file" ||
      !fileIds.has(node.id)
    ) {
      continue;
    }
    const file = toRepoMapFile(node);
    if (
      matchesSelection(
        file,
        context.currentFile,
      ) ||
      matchesAnySelection(
        file,
        context.openFiles,
      )
    ) {
      chatIds.add(file.id);
    }
  }
  return chatIds;
}

export function identifierEdgeMultiplier(
  ident: string,
  mentionedIdents: ReadonlySet<string>,
  definerCount: number,
): number {
  if (!ident) {
    return 1;
  }

  let mul = 1;
  const lower = ident.toLowerCase();
  if (
    mentionedIdents.has(lower) ||
    mentionedIdents.has(ident)
  ) {
    mul *=
      REPO_MAP_SCORE_WEIGHTS
        .IDENT_MENTIONED_MULTIPLIER;
  }

  const isSnake =
    ident.includes("_") &&
    /[a-zA-Z]/.test(ident);
  const isKebab =
    ident.includes("-") &&
    /[a-zA-Z]/.test(ident);
  const isCamel =
    /[A-Z]/.test(ident) &&
    /[a-z]/.test(ident);
  if (
    (isSnake || isKebab || isCamel) &&
    ident.length >=
      REPO_MAP_SCORE_WEIGHTS
        .IDENT_QUALITY_MINIMUM_LENGTH
  ) {
    mul *=
      REPO_MAP_SCORE_WEIGHTS
        .IDENT_QUALITY_MULTIPLIER;
  }

  if (ident.startsWith("_")) {
    mul *=
      REPO_MAP_SCORE_WEIGHTS
        .IDENT_PRIVATE_MULTIPLIER;
  }

  if (
    definerCount >
    REPO_MAP_SCORE_WEIGHTS
      .IDENT_HIGH_FANIN_THRESHOLD
  ) {
    mul *=
      REPO_MAP_SCORE_WEIGHTS
        .IDENT_HIGH_FANIN_MULTIPLIER;
  }

  return mul;
}

export function pathMentionsIdent(
  relativePath: string,
  mentionedIdents: ReadonlySet<string>,
): boolean {
  if (mentionedIdents.size === 0) {
    return false;
  }
  const components = relativePath
    .toLowerCase()
    .split(/[/._-]+/)
    .filter(
      (part) =>
        part.length >=
        REPO_MAP_DEFAULTS
          .MINIMUM_QUERY_TERM_LENGTH,
    );
  return components.some((part) =>
    mentionedIdents.has(part),
  );
}

function increment(
  values: Map<string, number>,
  key: string,
  amount: number,
): void {
  values.set(
    key,
    (values.get(key) ?? 0) + amount,
  );
}
