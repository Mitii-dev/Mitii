import type {
  ProjectDefinition,
} from "../catalog";

import type {
  CodeIndexFile,
  CodeIndexReference,
} from "../code-index";

import {
  normalizeRelativePath,
} from "./RepoGraphBuildContext";

import type {
  RepoGraphNode,
  RepoGraphSymbolNode,
} from "./types";

export function resolveReferenceTarget(
  reference: CodeIndexReference,
  nodes: ReadonlyMap<string, RepoGraphNode>,
): string | undefined {
  if (
    reference.toSymbolId &&
    nodes.has(reference.toSymbolId)
  ) {
    return reference.toSymbolId;
  }

  if (
    reference.toFileId &&
    nodes.has(reference.toFileId)
  ) {
    return reference.toFileId;
  }

  return undefined;
}

export function createSourceSymbolLookup(
  nodes: ReadonlyMap<string, RepoGraphNode>,
): ReadonlyMap<
  string,
  readonly RepoGraphSymbolNode[]
> {
  const symbolsByFileId = new Map<
    string,
    RepoGraphSymbolNode[]
  >();

  for (const node of nodes.values()) {
    if (node.kind !== "symbol") {
      continue;
    }

    const symbols =
      symbolsByFileId.get(node.fileId) ?? [];

    symbols.push(node);
    symbolsByFileId.set(node.fileId, symbols);
  }

  for (const symbols of symbolsByFileId.values()) {
    symbols.sort(
      (left, right) =>
        (right.startLine ?? 0) -
          (left.startLine ?? 0) ||
        symbolSpan(left) - symbolSpan(right) ||
        left.id.localeCompare(right.id),
    );
  }

  return symbolsByFileId;
}

export function resolveReferenceSource(
  reference: CodeIndexReference,
  symbolsByFileId: ReadonlyMap<
    string,
    readonly RepoGraphSymbolNode[]
  >,
): string | undefined {
  if (reference.line === undefined) {
    return undefined;
  }

  const symbols =
    symbolsByFileId.get(reference.fromFileId) ?? [];

  for (const symbol of symbols) {
    if (
      (symbol.startLine ?? 1) <= reference.line &&
      (symbol.endLine ??
        Number.MAX_SAFE_INTEGER) >= reference.line
    ) {
      return symbol.id;
    }
  }

  return undefined;
}

export function isCallReference(
  reference: CodeIndexReference,
): boolean {
  return (
    reference.kind === "call" ||
    reference.kind === "construct"
  );
}

export function findOwningProject(
  file: CodeIndexFile,
  projects: readonly ProjectDefinition[],
): ProjectDefinition | undefined {
  return projects
    .filter(
      (project) =>
        project.rootId === file.rootId &&
        isWithinProject(
          file.relativePath,
          project.relativeRoot,
        ),
    )
    .sort(
      (left, right) =>
        right.relativeRoot.length -
          left.relativeRoot.length ||
        left.id.localeCompare(right.id),
    )[0];
}

function symbolSpan(
  symbol: RepoGraphSymbolNode,
): number {
  if (
    symbol.startLine === undefined ||
    symbol.endLine === undefined
  ) {
    return Number.MAX_SAFE_INTEGER;
  }

  return symbol.endLine - symbol.startLine;
}

function isWithinProject(
  relativePath: string,
  relativeRoot: string,
): boolean {
  const path = normalizeRelativePath(relativePath);
  const root = normalizeRelativePath(relativeRoot);

  return (
    !root ||
    path === root ||
    path.startsWith(`${root}/`)
  );
}
