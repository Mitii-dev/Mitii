import type {
  ProjectCatalog,
  ProjectDefinition,
  ProjectRelationship,
} from "../catalog";

import {
  throwIfCodeIndexAborted,
} from "../code-index";

import type {
  CodeIndexContext,
  CodeIndexFile,
  CodeIndexImport,
  CodeIndexReadPort,
  CodeIndexReference,
  CodeIndexSymbol,
  CodeIndexSymbolQueryResult,
} from "../code-index";

import {
  REPO_GRAPH_NODE_ORDER,
  REPO_GRAPH_NODE_PREFIXES,
  REPO_GRAPH_PROJECT_RELATIONSHIP_TYPES,
  REPO_GRAPH_SCHEMA_VERSION,
  resolveRepoGraphBuilderOptions,
} from "./constants";

import {
  RepoGraphEdgeAccumulator,
} from "./RepoGraphEdgeAccumulator";

import {
  repoGraphSchema,
} from "./schema";

import type {
  RepoGraph,
  RepoGraphBuildAttempt,
  RepoGraphBuildInput,
  RepoGraphBuilderOptions,
  RepoGraphEdge,
  RepoGraphEdgeType,
  RepoGraphFileNode,
  RepoGraphIncludedFileResult,
  RepoGraphNode,
  RepoGraphProjectNode,
  RepoGraphStatistics,
  RepoGraphSymbolNode,
  RepoGraphWarning,
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

    this.validateOptions();
  }

  public async build(
    input: RepoGraphBuildInput,
  ): Promise<RepoGraph> {
    const startedAt = Date.now();

    this.validateInput(input);

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

      const context:
        CodeIndexContext = {
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
        return this.finalizeGraph({
          input,
          attempt: latestAttempt,
          changeToken:
            afterToken,
          consistencyRetries,
          durationMs:
            Date.now() -
            startedAt,
          indexChanged: false,
        });
      }

      consistencyRetries += 1;
    }

    if (!latestAttempt) {
      throw new Error(
        "Repo Graph build did not produce an attempt.",
      );
    }

    return this.finalizeGraph({
      input,
      attempt: latestAttempt,
      changeToken:
        latestChangeToken,
      consistencyRetries,
      durationMs:
        Date.now() - startedAt,
      indexChanged: true,
    });
  }

  private async buildAttempt(
    input: RepoGraphBuildInput,
    context: CodeIndexContext,
  ): Promise<RepoGraphBuildAttempt> {
    const warnings:
      RepoGraphWarning[] = [];

    const nodes =
      new Map<string, RepoGraphNode>();

    const projects =
      this.addProjectNodes(
        input.catalog,
        input.rootIds,
        nodes,
      );

    const includedFileResult =
      await this.loadAndAddFiles(
        input,
        context,
        projects,
        nodes,
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
      await this.loadAndAddSymbols(
        includedFileResult.files,
        context,
        nodes,
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
      await this.loadImportEdges(
        includedFileResult.files,
        context,
        nodes,
        edgeAccumulator,
      );

    const referenceResult =
      await this.loadReferenceEdges(
        includedFileResult.files,
        context,
        nodes,
        edgeAccumulator,
      );

    this.addProjectRelationshipEdges(
      input.catalog.relationships,
      nodes,
      edgeAccumulator,
      warnings,
    );

    const omittedParentSymbolTargets =
      this.addSymbolStructureEdges(
        nodes,
        edgeAccumulator,
      );

    this.addProjectContainmentEdges(
      nodes,
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
      nodes:
        [...nodes.values()].sort(
          (left, right) =>
            this.compareNodes(
              left,
              right,
            ),
        ),

      edges:
        edgeResult.edges,

      warnings,

      availableFiles:
        includedFileResult.totalAvailable,

      indexedFiles:
        includedFileResult.files.length,

      filesTruncated:
        includedFileResult
          .sourceTruncated ||
        includedFileResult
          .nodeLimitTruncated,

      nodesTruncated:
        includedFileResult
          .nodeLimitTruncated ||
        symbolLoadResult
          .nodesTruncated,

      symbolsTruncated:
        symbolLoadResult
          .truncatedFileIds.size > 0 ||
        symbolLoadResult
          .droppedSymbolNodes > 0,

      edgesTruncated:
        edgeResult.truncated,

      unresolvedImports:
        importResult
          .unresolvedImports,

      omittedImportTargets:
        importResult
          .omittedTargets,

      ambiguousReferences:
        referenceResult
          .ambiguousReferences,

      unresolvedReferences:
        referenceResult
          .unresolvedReferences,

      omittedReferenceTargets:
        referenceResult
          .omittedTargets,

      omittedParentSymbolTargets,

      truncatedSymbolFiles:
        symbolLoadResult
          .truncatedFileIds.size,

      droppedSymbolNodes:
        symbolLoadResult
          .droppedSymbolNodes,

      droppedEdges:
        edgeResult.droppedEdges,
    };
  }

  private addProjectNodes(
    catalog: ProjectCatalog,
    rootIds:
      readonly string[] | undefined,
    nodes:
      Map<string, RepoGraphNode>,
  ): ProjectDefinition[] {
    const allowedRootIds =
      rootIds
        ? new Set(rootIds)
        : undefined;

    const projects =
      catalog.projects
        .filter(
          (project) =>
            !allowedRootIds ||
            allowedRootIds.has(
              project.rootId,
            ),
        )
        .sort((left, right) =>
          this.compareProjects(
            left,
            right,
          ),
        );

    const included:
      ProjectDefinition[] = [];

    for (const project of projects) {
      if (
        nodes.size >=
        this.options.maximumNodes
      ) {
        break;
      }

      const node:
        RepoGraphProjectNode = {
        id:
          this.createProjectNodeId(
            project.id,
          ),

        kind: "project",
        projectId: project.id,
        rootId: project.rootId,

        relativeRoot:
          this.normalizeRelativePath(
            project.relativeRoot,
          ),

        name: project.name,

        ecosystems:
          [...project.ecosystems]
            .sort(),
      };

      nodes.set(node.id, node);
      included.push(project);
    }

    return included;
  }

  private async loadAndAddFiles(
    input: RepoGraphBuildInput,
    context: CodeIndexContext,
    projects:
      readonly ProjectDefinition[],
    nodes:
      Map<string, RepoGraphNode>,
  ): Promise<RepoGraphIncludedFileResult> {
    const fileResult =
      await this.codeIndex.getFiles(
        {
          maximumFiles:
            this.options.maximumFiles,

          ...(input.rootIds
            ? {
                rootIds:
                  input.rootIds,
              }
            : {}),
        },
        context,
      );

    const files:
      CodeIndexFile[] = [];

    let nodeLimitTruncated = false;

    for (
      const file of
      [...fileResult.files].sort(
        (left, right) =>
          this.compareFiles(
            left,
            right,
          ),
      )
    ) {
      if (
        nodes.size >=
        this.options.maximumNodes
      ) {
        nodeLimitTruncated = true;
        break;
      }

      const project =
        this.findOwningProject(
          file,
          projects,
        );

      const node:
        RepoGraphFileNode = {
        id: file.id,
        kind: "file",
        fileId: file.id,
        rootId: file.rootId,

        relativePath:
          this.normalizeRelativePath(
            file.relativePath,
          ),

        ...(project
          ? {
              projectId:
                project.id,
            }
          : {}),

        ...(file.language
          ? {
              language:
                file.language,
            }
          : {}),

        ...(file.size !== undefined
          ? {
              size: file.size,
            }
          : {}),

        ...(file.modifiedAt
          ? {
              modifiedAt:
                file.modifiedAt,
            }
          : {}),

        ...(file.contentHash
          ? {
              contentHash:
                file.contentHash,
            }
          : {}),
      };

      nodes.set(node.id, node);
      files.push(file);
    }

    return {
      files,
      totalAvailable:
        fileResult.totalAvailable,
      sourceTruncated:
        fileResult.truncated,
      nodeLimitTruncated,
    };
  }

  private async loadAndAddSymbols(
    files: readonly CodeIndexFile[],
    context: CodeIndexContext,
    nodes:
      Map<string, RepoGraphNode>,
  ): Promise<{
    truncatedFileIds: Set<string>;
    droppedSymbolNodes: number;
    nodesTruncated: boolean;
  }> {
    const truncatedFileIds =
      new Set<string>();

    const seenSymbolIds =
      new Set<string>();

    let symbolNodeCount = 0;
    let droppedSymbolNodes = 0;
    let nodesTruncated = false;

    const fileIds =
      files.map(
        (file) => file.id,
      );

    for (
      const batch of
      this.createBatches(
        fileIds,
        this.options.symbolBatchSize,
      )
    ) {
      throwIfCodeIndexAborted(
        context.abortSignal,
      );

      const result =
        await this.codeIndex.getSymbols(
          {
            fileIds: batch,

            maximumSymbolsPerFile:
              this.options
                .maximumSymbolsPerFile,
          },
          context,
        );

      this.validateSymbolResult(
        batch,
        result,
      );

      for (
        const fileId of
        result.truncatedFileIds
      ) {
        truncatedFileIds.add(fileId);
      }

      for (const fileId of batch) {
        const symbols =
          result.symbolsByFile.get(
            fileId,
          ) ?? [];

        for (
          const symbol of
          [...symbols].sort(
            (left, right) =>
              this.compareSymbols(
                left,
                right,
              ),
          )
        ) {
          if (
            symbolNodeCount >=
              this.options
                .maximumSymbolNodes ||
            nodes.size >=
              this.options.maximumNodes
          ) {
            droppedSymbolNodes += 1;
            nodesTruncated = true;
            truncatedFileIds.add(
              fileId,
            );
            continue;
          }

          if (
            seenSymbolIds.has(
              symbol.id,
            )
          ) {
            throw new Error(
              `Duplicate Code Index symbol ID "${symbol.id}".`,
            );
          }

          seenSymbolIds.add(
            symbol.id,
          );

          const node:
            RepoGraphSymbolNode = {
            id: symbol.id,
            kind: "symbol",
            symbolId: symbol.id,
            fileId:
              symbol.fileId,

            ...(symbol.parentSymbolId
              ? {
                  parentSymbolId:
                    symbol.parentSymbolId,
                }
              : {}),

            name: symbol.name,
            symbolKind:
              symbol.kind,

            ...(symbol.exported !==
            undefined
              ? {
                  exported:
                    symbol.exported,
                }
              : {}),

            ...(symbol.signature
              ? {
                  signature:
                    symbol.signature,
                }
              : {}),

            ...(symbol.startLine !==
            undefined
              ? {
                  startLine:
                    symbol.startLine,
                }
              : {}),

            ...(symbol.endLine !==
            undefined
              ? {
                  endLine:
                    symbol.endLine,
                }
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

  private async loadImportEdges(
    files: readonly CodeIndexFile[],
    context: CodeIndexContext,
    nodes:
      ReadonlyMap<
        string,
        RepoGraphNode
      >,
    edges:
      RepoGraphEdgeAccumulator,
  ): Promise<{
    unresolvedImports: number;
    omittedTargets: number;
  }> {
    let unresolvedImports = 0;
    let omittedTargets = 0;

    const fileIds =
      files.map(
        (file) => file.id,
      );

    for (
      const batch of
      this.createBatches(
        fileIds,
        this.options.graphBatchSize,
      )
    ) {
      throwIfCodeIndexAborted(
        context.abortSignal,
      );

      const imports =
        await this.codeIndex.getImports(
          batch,
          context,
        );

      for (
        const item of
        this.sortImports(imports)
      ) {
        if (
          item.resolution ===
          "unresolved"
        ) {
          unresolvedImports += 1;
          continue;
        }

        if (
          !nodes.has(
            item.fromFileId,
          ) ||
          !nodes.has(
            item.toFileId,
          )
        ) {
          omittedTargets += 1;
          continue;
        }

        if (
          item.fromFileId ===
          item.toFileId
        ) {
          continue;
        }

        edges.add({
          type: "imports",
          fromNodeId:
            item.fromFileId,
          toNodeId:
            item.toFileId,
          evidence: {
            source:
              "code_index_import",
            detail:
              item.specifier,
            ...(item.line !==
            undefined
              ? {
                  line: item.line,
                }
              : {}),
          },
        });
      }
    }

    return {
      unresolvedImports,
      omittedTargets,
    };
  }

  private async loadReferenceEdges(
    files: readonly CodeIndexFile[],
    context: CodeIndexContext,
    nodes:
      ReadonlyMap<
        string,
        RepoGraphNode
      >,
    edges:
      RepoGraphEdgeAccumulator,
  ): Promise<{
    ambiguousReferences: number;
    unresolvedReferences: number;
    omittedTargets: number;
  }> {
    let ambiguousReferences = 0;
    let unresolvedReferences = 0;
    let omittedTargets = 0;

    const fileIds =
      files.map(
        (file) => file.id,
      );

    for (
      const batch of
      this.createBatches(
        fileIds,
        this.options.graphBatchSize,
      )
    ) {
      throwIfCodeIndexAborted(
        context.abortSignal,
      );

      const references =
        await this.codeIndex.getReferences(
          batch,
          context,
        );

      for (
        const reference of
        this.sortReferences(
          references,
        )
      ) {
        if (
          reference.resolution ===
          "ambiguous"
        ) {
          ambiguousReferences += 1;
          continue;
        }

        if (
          reference.resolution ===
          "unresolved"
        ) {
          unresolvedReferences += 1;
          continue;
        }

        const targetNodeId =
          this.resolveReferenceTarget(
            reference,
            nodes,
          );

        if (
          !nodes.has(
            reference.fromFileId,
          ) ||
          !targetNodeId
        ) {
          omittedTargets += 1;
          continue;
        }

        if (
          reference.fromFileId ===
          targetNodeId
        ) {
          continue;
        }

        edges.add({
          type: "references",
          fromNodeId:
            reference.fromFileId,
          toNodeId:
            targetNodeId,
          evidence: {
            source:
              "code_index_reference",
            detail:
              reference.symbolName,
            ...(reference.line !==
            undefined
              ? {
                  line:
                    reference.line,
                }
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

  private addProjectRelationshipEdges(
    relationships:
      readonly ProjectRelationship[],
    nodes:
      ReadonlyMap<
        string,
        RepoGraphNode
      >,
    edges:
      RepoGraphEdgeAccumulator,
    warnings:
      RepoGraphWarning[],
  ): void {
    const supportedTypes =
      new Set<string>(
        REPO_GRAPH_PROJECT_RELATIONSHIP_TYPES,
      );

    const sorted =
      [...relationships].sort(
        (left, right) =>
          [
            left.fromProjectId,
            left.toProjectId,
            left.type,
          ]
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
      if (
        !supportedTypes.has(
          relationship.type,
        )
      ) {
        continue;
      }

      const fromNodeId =
        this.createProjectNodeId(
          relationship.fromProjectId,
        );

      const toNodeId =
        this.createProjectNodeId(
          relationship.toProjectId,
        );

      if (
        !nodes.has(fromNodeId) ||
        !nodes.has(toNodeId)
      ) {
        warnings.push({
          code:
            "project_relationship_target_missing",
          message:
            `Project relationship ` +
            `"${relationship.fromProjectId}" → ` +
            `"${relationship.toProjectId}" was omitted because one or both projects are outside the graph scope.`,
        });
        continue;
      }

      edges.add({
        type:
          relationship.type,
        fromNodeId,
        toNodeId,
        evidence: {
          source:
            "project_catalog",
          detail:
            relationship.type,
        },
      });
    }
  }

  private addSymbolStructureEdges(
    nodes:
      ReadonlyMap<
        string,
        RepoGraphNode
      >,
    edges:
      RepoGraphEdgeAccumulator,
  ): number {
    let omittedParentTargets = 0;

    const symbols =
      [...nodes.values()]
        .filter(
          (
            node,
          ): node is RepoGraphSymbolNode =>
            node.kind === "symbol",
        )
        .sort((left, right) =>
          left.id.localeCompare(
            right.id,
          ),
        );

    for (const symbol of symbols) {
      edges.add({
        type: "declares",
        fromNodeId:
          symbol.fileId,
        toNodeId:
          symbol.id,
        evidence: {
          source:
            "code_index_symbol",
          detail:
            symbol.name,
          ...(symbol.startLine !==
          undefined
            ? {
                line:
                  symbol.startLine,
              }
            : {}),
        },
      });

      if (!symbol.parentSymbolId) {
        continue;
      }

      if (
        !nodes.has(
          symbol.parentSymbolId,
        )
      ) {
        omittedParentTargets += 1;
        continue;
      }

      edges.add({
        type: "contains",
        fromNodeId:
          symbol.parentSymbolId,
        toNodeId:
          symbol.id,
        evidence: {
          source:
            "code_index_symbol",
          detail:
            symbol.name,
        },
      });
    }

    return omittedParentTargets;
  }

  private addProjectContainmentEdges(
    nodes:
      ReadonlyMap<
        string,
        RepoGraphNode
      >,
    edges:
      RepoGraphEdgeAccumulator,
  ): void {
    const files =
      [...nodes.values()]
        .filter(
          (
            node,
          ): node is RepoGraphFileNode =>
            node.kind === "file",
        )
        .sort((left, right) =>
          left.id.localeCompare(
            right.id,
          ),
        );

    for (const file of files) {
      if (!file.projectId) {
        continue;
      }

      const projectNodeId =
        this.createProjectNodeId(
          file.projectId,
        );

      if (
        !nodes.has(projectNodeId)
      ) {
        continue;
      }

      edges.add({
        type: "contains",
        fromNodeId:
          projectNodeId,
        toNodeId:
          file.id,
        evidence: {
          source:
            "project_catalog",
          detail:
            file.relativePath,
        },
      });
    }
  }

  private validateSymbolResult(
    requestedFileIds:
      readonly string[],
    result:
      CodeIndexSymbolQueryResult,
  ): void {
    const requested =
      new Set(requestedFileIds);

    const symbolIds =
      new Set<string>();

    for (
      const [
        fileId,
        symbols,
      ] of result.symbolsByFile
    ) {
      if (!requested.has(fileId)) {
        throw new Error(
          `Code Index returned symbols for unrequested file "${fileId}".`,
        );
      }

      for (const symbol of symbols) {
        if (
          symbol.fileId !== fileId
        ) {
          throw new Error(
            `Symbol "${symbol.id}" belongs to "${symbol.fileId}" but was returned under "${fileId}".`,
          );
        }

        if (
          symbolIds.has(
            symbol.id,
          )
        ) {
          throw new Error(
            `Duplicate symbol ID "${symbol.id}".`,
          );
        }

        symbolIds.add(
          symbol.id,
        );
      }
    }

    for (const fileId of requestedFileIds) {
      if (
        !result.symbolsByFile.has(
          fileId,
        )
      ) {
        throw new Error(
          `Code Index omitted the symbol result for requested file "${fileId}".`,
        );
      }
    }

    for (
      const fileId of
      result.truncatedFileIds
    ) {
      if (!requested.has(fileId)) {
        throw new Error(
          `Code Index reported truncation for unrequested file "${fileId}".`,
        );
      }
    }
  }

  private resolveReferenceTarget(
    reference:
      CodeIndexReference,
    nodes:
      ReadonlyMap<
        string,
        RepoGraphNode
      >,
  ): string | undefined {
    if (
      reference.toSymbolId &&
      nodes.has(
        reference.toSymbolId,
      )
    ) {
      return reference.toSymbolId;
    }

    if (
      reference.toFileId &&
      nodes.has(
        reference.toFileId,
      )
    ) {
      return reference.toFileId;
    }

    return undefined;
  }

  private findOwningProject(
    file: CodeIndexFile,
    projects:
      readonly ProjectDefinition[],
  ): ProjectDefinition | undefined {
    return projects
      .filter(
        (project) =>
          project.rootId ===
            file.rootId &&
          this.isWithinProject(
            file.relativePath,
            project.relativeRoot,
          ),
      )
      .sort(
        (left, right) =>
          right.relativeRoot.length -
            left.relativeRoot.length ||
          left.id.localeCompare(
            right.id,
          ),
      )[0];
  }

  private isWithinProject(
    relativePath: string,
    relativeRoot: string,
  ): boolean {
    const path =
      this.normalizeRelativePath(
        relativePath,
      );

    const root =
      this.normalizeRelativePath(
        relativeRoot,
      );

    return (
      !root ||
      path === root ||
      path.startsWith(
        `${root}/`,
      )
    );
  }

  private finalizeGraph(input: {
    input: RepoGraphBuildInput;
    attempt: RepoGraphBuildAttempt;
    changeToken: string;
    consistencyRetries: number;
    durationMs: number;
    indexChanged: boolean;
  }): RepoGraph {
    const warnings = [
      ...input.attempt.warnings,
    ];

    if (input.indexChanged) {
      warnings.push({
        code:
          "code_index_changed_during_build",
        message:
          "The Code Index changed during Repo Graph construction. The returned graph may represent a partial index state.",
      });
    }

    const partial =
      input.attempt.filesTruncated ||
      input.attempt.nodesTruncated ||
      input.attempt.symbolsTruncated ||
      input.attempt.edgesTruncated ||
      input.indexChanged;

    const graph: RepoGraph = {
      schemaVersion:
        REPO_GRAPH_SCHEMA_VERSION,

      workspaceSnapshotId:
        input.input.snapshot
          .snapshotId,

      codeIndexChangeToken:
        input.changeToken,

      nodes:
        input.attempt.nodes,

      edges:
        input.attempt.edges,

      warnings,

      statistics:
        this.buildStatistics(
          input.attempt,
          input.consistencyRetries,
          input.durationMs,
        ),

      status:
        partial
          ? "partial"
          : "complete",

      generatedAt:
        new Date().toISOString(),
    };

    return repoGraphSchema.parse(
      graph,
    ) as RepoGraph;
  }

  private buildStatistics(
    attempt:
      RepoGraphBuildAttempt,
    consistencyRetries: number,
    durationMs: number,
  ): RepoGraphStatistics {
    const countNodes = (
      kind:
        RepoGraphNode["kind"],
    ): number =>
      attempt.nodes.filter(
        (node) =>
          node.kind === kind,
      ).length;

    const countEdges = (
      ...types:
        RepoGraphEdgeType[]
    ): number => {
      const accepted =
        new Set(types);

      return attempt.edges.filter(
        (edge) =>
          accepted.has(edge.type),
      ).length;
    };

    return {
      availableFiles:
        attempt.availableFiles,
      indexedFiles:
        attempt.indexedFiles,
      projectNodes:
        countNodes("project"),
      fileNodes:
        countNodes("file"),
      symbolNodes:
        countNodes("symbol"),
      containsEdges:
        countEdges("contains"),
      declaresEdges:
        countEdges("declares"),
      importEdges:
        countEdges("imports"),
      referenceEdges:
        countEdges("references"),
      projectRelationshipEdges:
        countEdges(
          "workspace_member",
          "depends_on",
          "development_depends_on",
        ),
      unresolvedImports:
        attempt.unresolvedImports,
      omittedImportTargets:
        attempt.omittedImportTargets,
      ambiguousReferences:
        attempt.ambiguousReferences,
      unresolvedReferences:
        attempt.unresolvedReferences,
      omittedReferenceTargets:
        attempt.omittedReferenceTargets,
      omittedParentSymbolTargets:
        attempt
          .omittedParentSymbolTargets,
      truncatedSymbolFiles:
        attempt.truncatedSymbolFiles,
      droppedSymbolNodes:
        attempt.droppedSymbolNodes,
      droppedEdges:
        attempt.droppedEdges,
      consistencyRetries,
      durationMs:
        Math.max(
          0,
          durationMs,
        ),
    };
  }

  private createProjectNodeId(
    projectId: string,
  ): string {
    return (
      `${REPO_GRAPH_NODE_PREFIXES.PROJECT}:` +
      `${encodeURIComponent(
        projectId,
      )}`
    );
  }

  private createBatches<T>(
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
        values.slice(
          index,
          index + batchSize,
        ),
      );
    }

    return batches;
  }

  private sortImports(
    imports:
      readonly CodeIndexImport[],
  ): CodeIndexImport[] {
    return [...imports].sort(
      (left, right) =>
        [
          left.fromFileId,
          left.line ?? 0,
          left.specifier,
        ]
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

  private sortReferences(
    references:
      readonly CodeIndexReference[],
  ): CodeIndexReference[] {
    return [...references].sort(
      (left, right) =>
        [
          left.fromFileId,
          left.line ?? 0,
          left.symbolName,
        ]
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

  private normalizeRelativePath(
    value: string,
  ): string {
    return value
      .trim()
      .replace(/\\/g, "/")
      .replace(/^\.\/+/, "")
      .replace(/\/+/g, "/")
      .replace(/\/+$/, "");
  }

  private compareFiles(
    left: CodeIndexFile,
    right: CodeIndexFile,
  ): number {
    return (
      left.rootId.localeCompare(
        right.rootId,
      ) ||
      left.relativePath.localeCompare(
        right.relativePath,
      ) ||
      left.id.localeCompare(
        right.id,
      )
    );
  }

  private compareProjects(
    left: ProjectDefinition,
    right: ProjectDefinition,
  ): number {
    return (
      left.rootId.localeCompare(
        right.rootId,
      ) ||
      left.relativeRoot.localeCompare(
        right.relativeRoot,
      ) ||
      left.id.localeCompare(
        right.id,
      )
    );
  }

  private compareSymbols(
    left: CodeIndexSymbol,
    right: CodeIndexSymbol,
  ): number {
    return (
      (left.startLine ?? 0) -
        (right.startLine ?? 0) ||
      left.name.localeCompare(
        right.name,
      ) ||
      left.id.localeCompare(
        right.id,
      )
    );
  }

  private compareNodes(
    left: RepoGraphNode,
    right: RepoGraphNode,
  ): number {
    return (
      REPO_GRAPH_NODE_ORDER[
        left.kind
      ] -
        REPO_GRAPH_NODE_ORDER[
          right.kind
        ] ||
      left.id.localeCompare(
        right.id,
      )
    );
  }

  private validateInput(
    input: RepoGraphBuildInput,
  ): void {
    if (
      input.catalog
        .workspaceSnapshotId !==
      input.snapshot.snapshotId
    ) {
      throw new Error(
        "ProjectCatalog.workspaceSnapshotId must match WorkspaceSnapshot.snapshotId.",
      );
    }

    if (!input.rootIds) {
      return;
    }

    if (
      new Set(input.rootIds).size !==
      input.rootIds.length
    ) {
      throw new RangeError(
        "RepoGraphBuildInput.rootIds must be unique.",
      );
    }

    const snapshotRootIds =
      new Set(
        input.snapshot.roots.map(
          (root) => root.id,
        ),
      );

    for (
      const rootId of
      input.rootIds
    ) {
      if (
        !snapshotRootIds.has(
          rootId,
        )
      ) {
        throw new RangeError(
          `Unknown workspace root ID "${rootId}".`,
        );
      }
    }
  }

  private validateOptions(): void {
    const positiveValues = {
      maximumFiles:
        this.options.maximumFiles,
      maximumSymbolsPerFile:
        this.options
          .maximumSymbolsPerFile,
      maximumSymbolNodes:
        this.options.maximumSymbolNodes,
      maximumNodes:
        this.options.maximumNodes,
      maximumEdges:
        this.options.maximumEdges,
      maximumEvidencePerEdge:
        this.options
          .maximumEvidencePerEdge,
      symbolBatchSize:
        this.options.symbolBatchSize,
      graphBatchSize:
        this.options.graphBatchSize,
    };

    for (
      const [
        name,
        value,
      ] of Object.entries(
        positiveValues,
      )
    ) {
      if (
        !Number.isSafeInteger(value) ||
        value <= 0
      ) {
        throw new RangeError(
          `${name} must be a positive safe integer.`,
        );
      }
    }

    if (
      !Number.isSafeInteger(
        this.options
          .maximumConsistencyRetries,
      ) ||
      this.options
        .maximumConsistencyRetries <
        0
    ) {
      throw new RangeError(
        "maximumConsistencyRetries must be a non-negative safe integer.",
      );
    }
  }
}

