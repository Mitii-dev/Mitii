import type {
  ProjectDefinition,
} from "../catalog";

import {
  throwIfCodeIndexAborted,
} from "../code-index";

import type {
  CodeIndexFile,
  CodeIndexSymbolQueryResult,
} from "../code-index";

import {
  compareFiles,
  compareProjects,
  compareSymbols,
  createBatches,
  createProjectNodeId,
  normalizeRelativePath,
} from "./RepoGraphBuildContext";

import type {
  RepoGraphBuildContext,
} from "./RepoGraphBuildContext";

import {
  findOwningProject,
} from "./RepoGraphReferenceResolver";

import type {
  RepoGraphFileNode,
  RepoGraphIncludedFileResult,
  RepoGraphProjectNode,
  RepoGraphSymbolNode,
} from "./types";

export interface RepoGraphSymbolLoadResult {
  truncatedFileIds: Set<string>;
  droppedSymbolNodes: number;
  nodesTruncated: boolean;
}

export function addProjectNodes(
  context: RepoGraphBuildContext,
): ProjectDefinition[] {
  const { input, nodes, options } = context;

  const allowedRootIds = input.rootIds
    ? new Set(input.rootIds)
    : undefined;

  const projects = input.catalog.projects
    .filter(
      (project) =>
        !allowedRootIds ||
        allowedRootIds.has(project.rootId),
    )
    .sort(compareProjects);

  const included: ProjectDefinition[] = [];

  for (const project of projects) {
    if (nodes.size >= options.maximumNodes) {
      break;
    }

    const node: RepoGraphProjectNode = {
      id: createProjectNodeId(project.id),
      kind: "project",
      projectId: project.id,
      rootId: project.rootId,
      relativeRoot: normalizeRelativePath(
        project.relativeRoot,
      ),
      name: project.name,
      ecosystems: [...project.ecosystems].sort(),
    };

    nodes.set(node.id, node);
    included.push(project);
  }

  return included;
}

export async function loadAndAddFiles(
  context: RepoGraphBuildContext,
  projects: readonly ProjectDefinition[],
): Promise<RepoGraphIncludedFileResult> {
  const { codeIndex, input, nodes, options } = context;

  const fileResult = await codeIndex.getFiles(
    {
      maximumFiles: options.maximumFiles,

      ...(input.rootIds
        ? { rootIds: input.rootIds }
        : {}),
    },
    context.indexContext,
  );

  const files: CodeIndexFile[] = [];

  let nodeLimitTruncated = false;

  for (const file of [...fileResult.files].sort(
    compareFiles,
  )) {
    if (nodes.size >= options.maximumNodes) {
      nodeLimitTruncated = true;
      break;
    }

    const project = findOwningProject(file, projects);

    const node: RepoGraphFileNode = {
      id: file.id,
      kind: "file",
      fileId: file.id,
      rootId: file.rootId,

      relativePath: normalizeRelativePath(
        file.relativePath,
      ),

      ...(project ? { projectId: project.id } : {}),

      ...(file.language
        ? { language: file.language }
        : {}),

      ...(file.size !== undefined
        ? { size: file.size }
        : {}),

      ...(file.modifiedAt
        ? { modifiedAt: file.modifiedAt }
        : {}),

      ...(file.contentHash
        ? { contentHash: file.contentHash }
        : {}),
    };

    nodes.set(node.id, node);
    files.push(file);
  }

  return {
    files,
    totalAvailable: fileResult.totalAvailable,
    sourceTruncated: fileResult.truncated,
    nodeLimitTruncated,
  };
}

export async function loadAndAddSymbols(
  context: RepoGraphBuildContext,
  files: readonly CodeIndexFile[],
): Promise<RepoGraphSymbolLoadResult> {
  const { codeIndex, nodes, options } = context;

  const truncatedFileIds = new Set<string>();
  const seenSymbolIds = new Set<string>();

  let symbolNodeCount = 0;
  let droppedSymbolNodes = 0;
  let nodesTruncated = false;

  const fileIds = files.map((file) => file.id);

  for (const batch of createBatches(
    fileIds,
    options.symbolBatchSize,
  )) {
    throwIfCodeIndexAborted(
      context.indexContext.abortSignal,
    );

    const result = await codeIndex.getSymbols(
      {
        fileIds: batch,
        maximumSymbolsPerFile:
          options.maximumSymbolsPerFile,
      },
      context.indexContext,
    );

    validateSymbolResult(batch, result);

    for (const fileId of result.truncatedFileIds) {
      truncatedFileIds.add(fileId);
    }

    for (const fileId of batch) {
      const symbols =
        result.symbolsByFile.get(fileId) ?? [];

      for (const symbol of [...symbols].sort(
        compareSymbols,
      )) {
        if (
          symbolNodeCount >=
            options.maximumSymbolNodes ||
          nodes.size >= options.maximumNodes
        ) {
          droppedSymbolNodes += 1;
          nodesTruncated = true;
          truncatedFileIds.add(fileId);
          continue;
        }

        if (seenSymbolIds.has(symbol.id)) {
          throw new Error(
            `Duplicate Code Index symbol ID "${symbol.id}".`,
          );
        }

        seenSymbolIds.add(symbol.id);

        const node: RepoGraphSymbolNode = {
          id: symbol.id,
          kind: "symbol",
          symbolId: symbol.id,
          fileId: symbol.fileId,

          ...(symbol.parentSymbolId
            ? {
                parentSymbolId:
                  symbol.parentSymbolId,
              }
            : {}),

          name: symbol.name,
          symbolKind: symbol.kind,

          ...(symbol.exported !== undefined
            ? { exported: symbol.exported }
            : {}),

          ...(symbol.signature
            ? { signature: symbol.signature }
            : {}),

          ...(symbol.startLine !== undefined
            ? { startLine: symbol.startLine }
            : {}),

          ...(symbol.endLine !== undefined
            ? { endLine: symbol.endLine }
            : {}),
        };

        nodes.set(node.id, node);
        symbolNodeCount += 1;
      }
    }
  }

  return {
    truncatedFileIds,
    droppedSymbolNodes,
    nodesTruncated,
  };
}

function validateSymbolResult(
  requestedFileIds: readonly string[],
  result: CodeIndexSymbolQueryResult,
): void {
  const requested = new Set(requestedFileIds);
  const symbolIds = new Set<string>();

  for (const [fileId, symbols] of result.symbolsByFile) {
    if (!requested.has(fileId)) {
      throw new Error(
        `Code Index returned symbols for unrequested file "${fileId}".`,
      );
    }

    for (const symbol of symbols) {
      if (symbol.fileId !== fileId) {
        throw new Error(
          `Symbol "${symbol.id}" belongs to "${symbol.fileId}" but was returned under "${fileId}".`,
        );
      }

      if (symbolIds.has(symbol.id)) {
        throw new Error(
          `Duplicate symbol ID "${symbol.id}".`,
        );
      }

      symbolIds.add(symbol.id);
    }
  }

  for (const fileId of requestedFileIds) {
    if (!result.symbolsByFile.has(fileId)) {
      throw new Error(
        `Code Index omitted the symbol result for requested file "${fileId}".`,
      );
    }
  }

  for (const fileId of result.truncatedFileIds) {
    if (!requested.has(fileId)) {
      throw new Error(
        `Code Index reported truncation for unrequested file "${fileId}".`,
      );
    }
  }
}
