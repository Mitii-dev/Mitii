import type {
  ProjectDefinition,
} from "../catalog";

import type {
  CodeIndexContext,
  CodeIndexFile,
  CodeIndexImport,
  CodeIndexReadPort,
  CodeIndexReference,
  CodeIndexSymbol,
} from "../code-index";

import {
  REPO_GRAPH_NODE_ORDER,
  REPO_GRAPH_NODE_PREFIXES,
} from "./constants";

import type {
  RepoGraphBuildInput,
  RepoGraphBuilderOptions,
  RepoGraphNode,
  RepoGraphWarning,
} from "./types";

/**
 * Mutable state shared by the loaders for a single build attempt.
 */
export interface RepoGraphBuildContext {
  readonly codeIndex: CodeIndexReadPort;
  readonly options: Required<RepoGraphBuilderOptions>;
  readonly input: RepoGraphBuildInput;
  readonly indexContext: CodeIndexContext;
  readonly nodes: Map<string, RepoGraphNode>;
  readonly warnings: RepoGraphWarning[];
}

export function createRepoGraphBuildContext(
  parameters: {
    codeIndex: CodeIndexReadPort;
    options: Required<RepoGraphBuilderOptions>;
    input: RepoGraphBuildInput;
    indexContext: CodeIndexContext;
  },
): RepoGraphBuildContext {
  return {
    ...parameters,
    nodes: new Map<string, RepoGraphNode>(),
    warnings: [],
  };
}

export function createProjectNodeId(
  projectId: string,
): string {
  return (
    `${REPO_GRAPH_NODE_PREFIXES.PROJECT}:` +
    `${encodeURIComponent(projectId)}`
  );
}

export function createBatches<T>(
  values: readonly T[],
  batchSize: number,
): T[][] {
  const batches: T[][] = [];

  for (
    let index = 0;
    index < values.length;
    index += batchSize
  ) {
    batches.push(
      values.slice(index, index + batchSize),
    );
  }

  return batches;
}

export function normalizeRelativePath(
  value: string,
): string {
  return value
    .trim()
    .replace(/\\/g, "/")
    .replace(/^\.\/+/, "")
    .replace(/\/+/g, "/")
    .replace(/\/+$/, "");
}

export function sortImports(
  imports: readonly CodeIndexImport[],
): CodeIndexImport[] {
  return [...imports].sort((left, right) =>
    [left.fromFileId, left.line ?? 0, left.specifier]
      .join("\u0000")
      .localeCompare(
        [
          right.fromFileId,
          right.line ?? 0,
          right.specifier,
        ].join("\u0000"),
      ),
  );
}

export function sortReferences(
  references: readonly CodeIndexReference[],
): CodeIndexReference[] {
  return [...references].sort((left, right) =>
    [left.fromFileId, left.line ?? 0, left.symbolName]
      .join("\u0000")
      .localeCompare(
        [
          right.fromFileId,
          right.line ?? 0,
          right.symbolName,
        ].join("\u0000"),
      ),
  );
}

export function compareFiles(
  left: CodeIndexFile,
  right: CodeIndexFile,
): number {
  return (
    left.rootId.localeCompare(right.rootId) ||
    left.relativePath.localeCompare(
      right.relativePath,
    ) ||
    left.id.localeCompare(right.id)
  );
}

export function compareProjects(
  left: ProjectDefinition,
  right: ProjectDefinition,
): number {
  return (
    left.rootId.localeCompare(right.rootId) ||
    left.relativeRoot.localeCompare(
      right.relativeRoot,
    ) ||
    left.id.localeCompare(right.id)
  );
}

export function compareSymbols(
  left: CodeIndexSymbol,
  right: CodeIndexSymbol,
): number {
  return (
    (left.startLine ?? 0) -
      (right.startLine ?? 0) ||
    left.name.localeCompare(right.name) ||
    left.id.localeCompare(right.id)
  );
}

export function compareNodes(
  left: RepoGraphNode,
  right: RepoGraphNode,
): number {
  return (
    REPO_GRAPH_NODE_ORDER[left.kind] -
      REPO_GRAPH_NODE_ORDER[right.kind] ||
    left.id.localeCompare(right.id)
  );
}
