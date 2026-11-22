import {
  throwIfCodeIndexAborted,
} from "../code-index";

import type {
  CodeIndexContext,
  CodeIndexReadPort,
} from "../code-index";

import {
  resolveRepoGraphBuilderOptions,
} from "./constants";

import {
  compareNodes,
  createRepoGraphBuildContext,
} from "./RepoGraphBuildContext";

import {
  RepoGraphEdgeAccumulator,
} from "./RepoGraphEdgeAccumulator";

import {
  addProjectContainmentEdges,
  addProjectRelationshipEdges,
  addSymbolStructureEdges,
  loadImportEdges,
  loadReferenceEdges,
} from "./RepoGraphEdgeLoader";

import {
  loadConfigExtendsEdges,
} from "./loadConfigExtendsEdges";

import {
  retainDeletedPathTombstones,
} from "./retainDeletedPathTombstones";

import {
  finalizeGraph,
} from "./RepoGraphFinalize";

import {
  addProjectNodes,
  loadAndAddFiles,
  loadAndAddSymbols,
} from "./RepoGraphNodeLoader";

import {
  validateRepoGraphInput,
  validateRepoGraphOptions,
} from "./RepoGraphValidation";

import type {
  RepoGraph,
  RepoGraphBuildAttempt,
  RepoGraphBuildInput,
  RepoGraphBuilderOptions,
} from "./types";

export class RepoGraphBuilder {
  private readonly options:
    Required<RepoGraphBuilderOptions>;

  constructor(
    private readonly codeIndex:
      CodeIndexReadPort,
    options:
      RepoGraphBuilderOptions = {},
  ) {
    this.options =
      resolveRepoGraphBuilderOptions(
        options,
      );

    validateRepoGraphOptions(
      this.options,
    );
  }

  public async build(
    input: RepoGraphBuildInput,
  ): Promise<RepoGraph> {
    const startedAt = Date.now();

    validateRepoGraphInput(input);

    let consistencyRetries = 0;
    let latestAttempt:
      RepoGraphBuildAttempt | undefined;
    let latestChangeToken = "";

    for (
      let attemptNumber = 0;
      attemptNumber <=
      this.options.maximumConsistencyRetries;
      attemptNumber += 1
    ) {
      throwIfCodeIndexAborted(
        input.abortSignal,
      );

      const context: CodeIndexContext = {
        snapshot: input.snapshot,

        ...(input.abortSignal
          ? {
              abortSignal:
                input.abortSignal,
            }
          : {}),
      };

      const beforeToken =
        await this.codeIndex.getChangeToken(
          context,
        );

      latestAttempt =
        await this.buildAttempt(
          input,
          context,
        );

      const afterToken =
        await this.codeIndex.getChangeToken(
          context,
        );

      latestChangeToken =
        afterToken;

      if (
        beforeToken === afterToken
      ) {
        return this.finalizeWithTombstones(
          input,
          finalizeGraph({
            input,
            attempt: latestAttempt,
            changeToken:
              afterToken,
            consistencyRetries,
            durationMs:
              Date.now() -
              startedAt,
            indexChanged: false,
          }),
        );
      }

      consistencyRetries += 1;
    }

    if (!latestAttempt) {
      throw new Error(
        "Repo Graph build did not produce an attempt.",
      );
    }

    return this.finalizeWithTombstones(
      input,
      finalizeGraph({
        input,
        attempt: latestAttempt,
        changeToken:
          latestChangeToken,
        consistencyRetries,
        durationMs:
          Date.now() - startedAt,
        indexChanged: true,
      }),
    );
  }

  private finalizeWithTombstones(
    input: RepoGraphBuildInput,
    graph: RepoGraph,
  ): RepoGraph {
    const presentRelativePaths = new Set(
      input.snapshot.entries
        .filter((entry) => entry.kind === "file")
        .map((entry) =>
          entry.relativePath.replace(/\\/g, "/").replace(/^\/+/, ""),
        ),
    );
    return retainDeletedPathTombstones({
      graph,
      priorGraph: input.priorGraph,
      presentRelativePaths,
    });
  }

  private async buildAttempt(
    input: RepoGraphBuildInput,
    indexContext: CodeIndexContext,
  ): Promise<RepoGraphBuildAttempt> {
    const context =
      createRepoGraphBuildContext({
        codeIndex: this.codeIndex,
        options: this.options,
        input,
        indexContext,
      });

    const { nodes, warnings } = context;

    const projects =
      addProjectNodes(context);

    const includedFileResult =
      await loadAndAddFiles(
        context,
        projects,
      );

    if (
      includedFileResult.sourceTruncated
    ) {
      warnings.push({
        code:
          "maximum_files_reached",
        message:
          `Repo Graph file limit of ` +
          `${this.options.maximumFiles} was reached.`,
      });
    }

    if (
      includedFileResult
        .nodeLimitTruncated
    ) {
      warnings.push({
        code:
          "maximum_nodes_reached",
        message:
          `Repo Graph node limit of ` +
          `${this.options.maximumNodes} prevented some files from being included.`,
      });
    }

    const symbolLoadResult =
      await loadAndAddSymbols(
        context,
        includedFileResult.files,
      );

    if (
      symbolLoadResult
        .truncatedFileIds.size > 0
    ) {
      warnings.push({
        code:
          "symbols_truncated",
        message:
          `Symbols were truncated for ` +
          `${symbolLoadResult.truncatedFileIds.size} files.`,
      });
    }

    if (
      symbolLoadResult
        .droppedSymbolNodes > 0
    ) {
      warnings.push({
        code:
          "maximum_symbol_nodes_reached",
        message:
          `Repo Graph symbol/node limits omitted ` +
          `${symbolLoadResult.droppedSymbolNodes} symbol nodes.`,
      });
    }

    const edgeAccumulator =
      new RepoGraphEdgeAccumulator({
        maximumEdges:
          this.options.maximumEdges,

        maximumEvidencePerEdge:
          this.options
            .maximumEvidencePerEdge,
      });

    /*
     * Edge categories are processed in budget priority order.
     */
    const importResult =
      await loadImportEdges(
        context,
        includedFileResult.files,
        edgeAccumulator,
      );

    const referenceResult =
      await loadReferenceEdges(
        context,
        includedFileResult.files,
        edgeAccumulator,
      );

    addProjectRelationshipEdges(
      context,
      input.catalog.relationships,
      edgeAccumulator,
    );

    const fileNodes = [...nodes.values()].filter(
      (node): node is import("./types").RepoGraphFileNode =>
        node.kind === "file",
    );
    await loadConfigExtendsEdges({
      fileNodes,
      edges: edgeAccumulator,
      readWorkspaceText: input.readWorkspaceText,
    });

    const omittedParentSymbolTargets =
      addSymbolStructureEdges(
        context,
        edgeAccumulator,
      );

    addProjectContainmentEdges(
      context,
      edgeAccumulator,
    );

    const edgeResult =
      edgeAccumulator.result();

    if (edgeResult.truncated) {
      warnings.push({
        code:
          "maximum_edges_reached",
        message:
          `Repo Graph edge limit of ` +
          `${this.options.maximumEdges} omitted ` +
          `${edgeResult.droppedEdges} edges.`,
      });
    }

    return {
      nodes: [...nodes.values()].sort(compareNodes),
      edges: edgeResult.edges,
      warnings,
      availableFiles:
        includedFileResult.totalAvailable,
      indexedFiles: includedFileResult.files.length,
      filesTruncated:
        includedFileResult.sourceTruncated ||
        includedFileResult.nodeLimitTruncated,
      nodesTruncated:
        includedFileResult.nodeLimitTruncated ||
        symbolLoadResult.nodesTruncated,
      symbolsTruncated:
        symbolLoadResult.truncatedFileIds.size > 0 ||
        symbolLoadResult.droppedSymbolNodes > 0,
      edgesTruncated: edgeResult.truncated,
      unresolvedImports: importResult.unresolvedImports,
      omittedImportTargets: importResult.omittedTargets,
      ambiguousReferences:
        referenceResult.ambiguousReferences,
      unresolvedReferences:
        referenceResult.unresolvedReferences,
      omittedReferenceTargets:
        referenceResult.omittedTargets,
      omittedParentSymbolTargets,
      truncatedSymbolFiles:
        symbolLoadResult.truncatedFileIds.size,
      droppedSymbolNodes:
        symbolLoadResult.droppedSymbolNodes,
      droppedEdges: edgeResult.droppedEdges,
    };
  }
}
