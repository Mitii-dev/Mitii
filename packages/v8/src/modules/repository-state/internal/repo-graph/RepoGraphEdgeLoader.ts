import type {
  ProjectRelationship,
} from "../catalog";

import {
  throwIfCodeIndexAborted,
} from "../code-index";

import type {
  CodeIndexFile,
} from "../code-index";

import {
  REPO_GRAPH_PROJECT_RELATIONSHIP_TYPES,
} from "./constants";

import {
  createBatches,
  createProjectNodeId,
  sortImports,
  sortReferences,
} from "./RepoGraphBuildContext";

import type {
  RepoGraphBuildContext,
} from "./RepoGraphBuildContext";

import type {
  RepoGraphEdgeAccumulator,
} from "./RepoGraphEdgeAccumulator";

import {
  createSourceSymbolLookup,
  isCallReference,
  resolveReferenceSource,
  resolveReferenceTarget,
} from "./RepoGraphReferenceResolver";

import type {
  RepoGraphFileNode,
  RepoGraphSymbolNode,
} from "./types";

export interface RepoGraphImportEdgeResult {
  unresolvedImports: number;
  omittedTargets: number;
}

export interface RepoGraphReferenceEdgeResult {
  ambiguousReferences: number;
  unresolvedReferences: number;
  omittedTargets: number;
}

export async function loadImportEdges(
  context: RepoGraphBuildContext,
  files: readonly CodeIndexFile[],
  edges: RepoGraphEdgeAccumulator,
): Promise<RepoGraphImportEdgeResult> {
  const { codeIndex, nodes, options } = context;

  let unresolvedImports = 0;
  let omittedTargets = 0;

  const fileIds = files.map((file) => file.id);

  for (const batch of createBatches(
    fileIds,
    options.graphBatchSize,
  )) {
    throwIfCodeIndexAborted(
      context.indexContext.abortSignal,
    );

    const imports = await codeIndex.getImports(
      batch,
      context.indexContext,
    );

    for (const item of sortImports(imports)) {
      if (item.resolution === "unresolved") {
        unresolvedImports += 1;
        continue;
      }

      if (
        !nodes.has(item.fromFileId) ||
        !nodes.has(item.toFileId)
      ) {
        omittedTargets += 1;
        continue;
      }

      if (item.fromFileId === item.toFileId) {
        continue;
      }

      edges.add({
        type: "imports",
        fromNodeId: item.fromFileId,
        toNodeId: item.toFileId,
        evidence: {
          source: "code_index_import",
          detail: item.specifier,
          ...(item.line !== undefined
            ? { line: item.line }
            : {}),
        },
      });
    }
  }

  return { unresolvedImports, omittedTargets };
}

export async function loadReferenceEdges(
  context: RepoGraphBuildContext,
  files: readonly CodeIndexFile[],
  edges: RepoGraphEdgeAccumulator,
): Promise<RepoGraphReferenceEdgeResult> {
  const { codeIndex, nodes, options } = context;

  let ambiguousReferences = 0;
  let unresolvedReferences = 0;
  let omittedTargets = 0;

  const fileIds = files.map((file) => file.id);

  const sourceSymbolsByFileId =
    createSourceSymbolLookup(nodes);

  for (const batch of createBatches(
    fileIds,
    options.graphBatchSize,
  )) {
    throwIfCodeIndexAborted(
      context.indexContext.abortSignal,
    );

    const references = await codeIndex.getReferences(
      batch,
      context.indexContext,
    );

    for (const reference of sortReferences(
      references,
    )) {
      if (reference.resolution === "ambiguous") {
        ambiguousReferences += 1;
        continue;
      }

      if (reference.resolution === "unresolved") {
        unresolvedReferences += 1;
        continue;
      }

      const targetNodeId = resolveReferenceTarget(
        reference,
        nodes,
      );

      if (
        !nodes.has(reference.fromFileId) ||
        !targetNodeId
      ) {
        omittedTargets += 1;
        continue;
      }

      if (reference.fromFileId === targetNodeId) {
        continue;
      }

      edges.add({
        type: "references",
        fromNodeId: reference.fromFileId,
        toNodeId: targetNodeId,
        evidence: {
          source: "code_index_reference",
          detail: reference.symbolName,
          ...(reference.line !== undefined
            ? { line: reference.line }
            : {}),
        },
      });

      if (
        (reference.kind === "implements" ||
          reference.kind === "extends") &&
        reference.toSymbolId &&
        nodes.has(reference.toSymbolId)
      ) {
        const heritageSource =
          resolveReferenceSource(
            reference,
            sourceSymbolsByFileId,
          ) ?? reference.fromFileId;

        if (heritageSource !== reference.toSymbolId) {
          edges.add({
            type: reference.kind,
            fromNodeId: heritageSource,
            toNodeId: reference.toSymbolId,
            evidence: {
              source: "code_index_reference",
              detail: reference.kind,
              ...(reference.line !== undefined
                ? { line: reference.line }
                : {}),
            },
          });
        }
      }

      if (
        !isCallReference(reference) ||
        !reference.toSymbolId ||
        !nodes.has(reference.toSymbolId)
      ) {
        continue;
      }

      const sourceNodeId =
        resolveReferenceSource(
          reference,
          sourceSymbolsByFileId,
        ) ?? reference.fromFileId;

      if (sourceNodeId === reference.toSymbolId) {
        continue;
      }

      edges.add({
        type: "calls",
        fromNodeId: sourceNodeId,
        toNodeId: reference.toSymbolId,
        evidence: {
          source: "code_index_reference",
          detail: reference.kind,
          ...(reference.line !== undefined
            ? { line: reference.line }
            : {}),
        },
      });
    }
  }

  return {
    ambiguousReferences,
    unresolvedReferences,
    omittedTargets,
  };
}

export function addProjectRelationshipEdges(
  context: RepoGraphBuildContext,
  relationships: readonly ProjectRelationship[],
  edges: RepoGraphEdgeAccumulator,
): void {
  const { nodes, warnings } = context;

  const supportedTypes = new Set<string>(
    REPO_GRAPH_PROJECT_RELATIONSHIP_TYPES,
  );

  const sorted = [...relationships].sort(
    (left, right) =>
      [left.fromProjectId, left.toProjectId, left.type]
        .join("\u0000")
        .localeCompare(
          [
            right.fromProjectId,
            right.toProjectId,
            right.type,
          ].join("\u0000"),
        ),
  );

  for (const relationship of sorted) {
    if (!supportedTypes.has(relationship.type)) {
      continue;
    }

    const fromNodeId = createProjectNodeId(
      relationship.fromProjectId,
    );

    const toNodeId = createProjectNodeId(
      relationship.toProjectId,
    );

    if (
      !nodes.has(fromNodeId) ||
      !nodes.has(toNodeId)
    ) {
      warnings.push({
        code: "project_relationship_target_missing",
        message:
          `Project relationship ` +
          `"${relationship.fromProjectId}" → ` +
          `"${relationship.toProjectId}" was omitted because one or both projects are outside the graph scope.`,
      });
      continue;
    }

    edges.add({
      type: relationship.type,
      fromNodeId,
      toNodeId,
      evidence: {
        source: "project_catalog",
        detail: relationship.type,
      },
    });
  }
}

export function addSymbolStructureEdges(
  context: RepoGraphBuildContext,
  edges: RepoGraphEdgeAccumulator,
): number {
  const { nodes } = context;

  let omittedParentTargets = 0;

  const symbols = [...nodes.values()]
    .filter(
      (node): node is RepoGraphSymbolNode =>
        node.kind === "symbol",
    )
    .sort((left, right) =>
      left.id.localeCompare(right.id),
    );

  for (const symbol of symbols) {
    edges.add({
      type: "declares",
      fromNodeId: symbol.fileId,
      toNodeId: symbol.id,
      evidence: {
        source: "code_index_symbol",
        detail: symbol.name,
        ...(symbol.startLine !== undefined
          ? { line: symbol.startLine }
          : {}),
      },
    });

    if (!symbol.parentSymbolId) {
      continue;
    }

    if (!nodes.has(symbol.parentSymbolId)) {
      omittedParentTargets += 1;
      continue;
    }

    edges.add({
      type: "contains",
      fromNodeId: symbol.parentSymbolId,
      toNodeId: symbol.id,
      evidence: {
        source: "code_index_symbol",
        detail: symbol.name,
      },
    });
  }

  return omittedParentTargets;
}

export function addProjectContainmentEdges(
  context: RepoGraphBuildContext,
  edges: RepoGraphEdgeAccumulator,
): void {
  const { nodes } = context;

  const files = [...nodes.values()]
    .filter(
      (node): node is RepoGraphFileNode =>
        node.kind === "file",
    )
    .sort((left, right) =>
      left.id.localeCompare(right.id),
    );

  for (const file of files) {
    if (!file.projectId) {
      continue;
    }

    const projectNodeId = createProjectNodeId(
      file.projectId,
    );

    if (!nodes.has(projectNodeId)) {
      continue;
    }

    edges.add({
      type: "contains",
      fromNodeId: projectNodeId,
      toNodeId: file.id,
      evidence: {
        source: "project_catalog",
        detail: file.relativePath,
      },
    });
  }
}
