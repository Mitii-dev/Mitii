import type {
  ProjectCatalog,
  ProjectDefinition,
  ProjectRelationship,
} from "../catalog";

import { throwIfCodeIndexAborted } from "../code-index";

import type {
  CodeIndexContext,
  CodeIndexFile,
  CodeIndexImport,
  CodeIndexReadPort,
  CodeIndexReference,
  CodeIndexSymbol,
} from "../code-index";

import {
  REPO_GRAPH_EDGE_ORDER,
  REPO_GRAPH_EDGE_PREFIX,
  REPO_GRAPH_NODE_PREFIXES,
  REPO_GRAPH_PROJECT_RELATIONSHIP_TYPES,
  REPO_GRAPH_SCHEMA_VERSION,
  resolveRepoGraphBuilderOptions,
} from "./constants";

import { repoGraphSchema } from "./schema";

import type {
  RepoGraph,
  RepoGraphBuildAttempt,
  RepoGraphBuildInput,
  RepoGraphBuilderOptions,
  RepoGraphEdge,
  RepoGraphEdgeEvidence,
  RepoGraphEdgeType,
  RepoGraphFileNode,
  RepoGraphNode,
  RepoGraphProjectNode,
  RepoGraphStatistics,
  RepoGraphSymbolNode,
  RepoGraphWarning,
} from "./types";

interface MutableEdgeState {
  edges: Map<string, RepoGraphEdge>;
  truncated: boolean;
}

export class RepoGraphBuilder {
  private readonly options: Required<RepoGraphBuilderOptions>;

  constructor(
    private readonly codeIndex: CodeIndexReadPort,

    options: RepoGraphBuilderOptions = {},
  ) {
    this.options = resolveRepoGraphBuilderOptions(options);

    this.validateOptions();
  }

  public async build(input: RepoGraphBuildInput): Promise<RepoGraph> {
    const startedAt = Date.now();

    this.validateInput(input);

    let consistencyRetries = 0;

    let latestAttempt: RepoGraphBuildAttempt | undefined;

    let latestChangeToken = "";

    for (
      let attemptNumber = 0;
      attemptNumber <= this.options.maximumConsistencyRetries;
      attemptNumber += 1
    ) {
      throwIfCodeIndexAborted(input.abortSignal);

      const context: CodeIndexContext = {
        snapshot: input.snapshot,

        ...(input.abortSignal
          ? {
              abortSignal: input.abortSignal,
            }
          : {}),
      };

      const beforeToken = await this.codeIndex.getChangeToken(context);

      latestAttempt = await this.buildAttempt(input, context);

      const afterToken = await this.codeIndex.getChangeToken(context);

      latestChangeToken = afterToken;

      if (beforeToken === afterToken) {
        return this.finalizeGraph({
          input,
          attempt: latestAttempt,
          changeToken: afterToken,
          consistencyRetries,
          durationMs: Date.now() - startedAt,
          indexChanged: false,
        });
      }

      consistencyRetries += 1;
    }

    if (!latestAttempt) {
      throw new Error("Repo Graph build did not produce an attempt.");
    }

    return this.finalizeGraph({
      input,
      attempt: latestAttempt,
      changeToken: latestChangeToken,
      consistencyRetries,
      durationMs: Date.now() - startedAt,
      indexChanged: true,
    });
  }

  private async buildAttempt(
    input: RepoGraphBuildInput,
    context: CodeIndexContext,
  ): Promise<RepoGraphBuildAttempt> {
    const warnings: RepoGraphWarning[] = [];

    const fileResult = await this.codeIndex.getFiles(
      {
        maximumFiles: this.options.maximumFiles,

        ...(input.rootIds
          ? {
              rootIds: input.rootIds,
            }
          : {}),
      },
      context,
    );

    if (fileResult.truncated) {
      warnings.push({
        code: "maximum_files_reached",

        message:
          `Repo Graph file limit of ` +
          `${this.options.maximumFiles} was reached.`,
      });
    }

    const files = [...fileResult.files].sort((left, right) =>
      this.compareFiles(left, right),
    );

    const fileIds = files.map((file) => file.id);

    const [symbolMap, imports, references] = await Promise.all([
      this.codeIndex.getSymbols(
        {
          fileIds,

          maximumSymbolsPerFile: this.options.maximumSymbolsPerFile,
        },
        context,
      ),

      this.codeIndex.getImports(fileIds, context),

      this.codeIndex.getReferences(fileIds, context),
    ]);

    throwIfCodeIndexAborted(input.abortSignal);

    const nodes = new Map<string, RepoGraphNode>();

    const edgeState: MutableEdgeState = {
      edges: new Map<string, RepoGraphEdge>(),

      truncated: false,
    };

    const includedProjects = this.addProjectNodes(
      input.catalog,
      input.rootIds,
      nodes,
    );

    const fileProjectIds = this.addFileNodes(
      files,
      includedProjects,
      nodes,
      edgeState,
    );

    this.addSymbolNodes(files, symbolMap, nodes, edgeState);

    const importStatistics = this.addImportEdges(imports, nodes, edgeState);

    const referenceStatistics = this.addReferenceEdges(
      references,
      nodes,
      edgeState,
    );

    this.addProjectRelationships(
      input.catalog.relationships,
      nodes,
      edgeState,
      warnings,
    );

    if (edgeState.truncated) {
      warnings.push({
        code: "maximum_edges_reached",

        message:
          `Repo Graph edge limit of ` +
          `${this.options.maximumEdges} was reached.`,
      });
    }

    /*
     * fileProjectIds is currently populated while adding file nodes.
     * Keeping it explicit ensures project assignment remains a
     * deterministic part of graph construction.
     */
    void fileProjectIds;

    return {
      nodes: [...nodes.values()].sort((left, right) =>
        this.compareNodes(left, right),
      ),

      edges: [...edgeState.edges.values()]
        .map((edge) => ({
          ...edge,

          evidence: [...edge.evidence],
        }))
        .sort((left, right) => this.compareEdges(left, right)),

      warnings,

      fileResult: {
        files: fileResult.files,

        totalAvailable: fileResult.totalAvailable,

        truncated: fileResult.truncated,
      },

      unresolvedImports: importStatistics.unresolvedImports,

      omittedImportTargets: importStatistics.omittedTargets,

      omittedReferenceTargets: referenceStatistics.omittedTargets,

      edgesTruncated: edgeState.truncated,
    };
  }

  private addProjectNodes(
    catalog: ProjectCatalog,
    rootIds: readonly string[] | undefined,
    nodes: Map<string, RepoGraphNode>,
  ): ProjectDefinition[] {
    const allowedRootIds = rootIds ? new Set(rootIds) : undefined;

    const projects = catalog.projects
      .filter(
        (project) => !allowedRootIds || allowedRootIds.has(project.rootId),
      )
      .sort((left, right) => this.compareProjects(left, right));

    for (const project of projects) {
      const node: RepoGraphProjectNode = {
        id: this.createProjectNodeId(project.id),

        kind: "project",

        projectId: project.id,

        rootId: project.rootId,

        relativeRoot: this.normalizeRelativePath(project.relativeRoot),

        name: project.name,

        ecosystems: [...project.ecosystems].sort(),
      };

      nodes.set(node.id, node);
    }

    return projects;
  }

  private addFileNodes(
    files: readonly CodeIndexFile[],
    projects: readonly ProjectDefinition[],
    nodes: Map<string, RepoGraphNode>,
    edgeState: MutableEdgeState,
  ): ReadonlyMap<string, string> {
    const fileProjectIds = new Map<string, string>();

    for (const file of files) {
      const project = this.findOwningProject(file, projects);

      const node: RepoGraphFileNode = {
        id: file.id,

        kind: "file",

        fileId: file.id,

        rootId: file.rootId,

        relativePath: this.normalizeRelativePath(file.relativePath),

        ...(project
          ? {
              projectId: project.id,
            }
          : {}),

        ...(file.language
          ? {
              language: file.language,
            }
          : {}),

        ...(file.size !== undefined
          ? {
              size: file.size,
            }
          : {}),

        ...(file.modifiedAt
          ? {
              modifiedAt: file.modifiedAt,
            }
          : {}),

        ...(file.contentHash
          ? {
              contentHash: file.contentHash,
            }
          : {}),
      };

      nodes.set(node.id, node);

      if (!project) {
        continue;
      }

      fileProjectIds.set(file.id, project.id);

      this.addEdge(edgeState, {
        type: "contains",

        fromNodeId: this.createProjectNodeId(project.id),

        toNodeId: file.id,

        evidence: {
          source: "project_catalog",

          detail: file.relativePath,
        },
      });
    }

    return fileProjectIds;
  }

  private addSymbolNodes(
    files: readonly CodeIndexFile[],
    symbolMap: ReadonlyMap<string, readonly CodeIndexSymbol[]>,
    nodes: Map<string, RepoGraphNode>,
    edgeState: MutableEdgeState,
  ): void {
    for (const file of files) {
      const symbols = [...(symbolMap.get(file.id) ?? [])].sort((left, right) =>
        this.compareSymbols(left, right),
      );

      for (const symbol of symbols) {
        const node: RepoGraphSymbolNode = {
          id: symbol.id,

          kind: "symbol",

          symbolId: symbol.id,

          fileId: symbol.fileId,

          name: symbol.name,

          symbolKind: symbol.kind,

          ...(symbol.exported !== undefined
            ? {
                exported: symbol.exported,
              }
            : {}),

          ...(symbol.signature
            ? {
                signature: symbol.signature,
              }
            : {}),

          ...(symbol.startLine !== undefined
            ? {
                startLine: symbol.startLine,
              }
            : {}),

          ...(symbol.endLine !== undefined
            ? {
                endLine: symbol.endLine,
              }
            : {}),
        };

        nodes.set(node.id, node);

        this.addEdge(edgeState, {
          type: "declares",

          fromNodeId: file.id,

          toNodeId: symbol.id,

          evidence: {
            source: "code_index_symbol",

            detail: symbol.name,
          },
        });
      }
    }
  }

  private addImportEdges(
    imports: readonly CodeIndexImport[],
    nodes: ReadonlyMap<string, RepoGraphNode>,
    edgeState: MutableEdgeState,
  ): {
    unresolvedImports: number;
    omittedTargets: number;
  } {
    let unresolvedImports = 0;
    let omittedTargets = 0;

    const sortedImports = [...imports].sort((left, right) => {
      const fromComparison = left.fromFileId.localeCompare(right.fromFileId);

      if (fromComparison !== 0) {
        return fromComparison;
      }

      const leftTarget =
        left.resolution === "resolved"
          ? left.toFileId
          : (left.candidateRelativePath ?? left.specifier ?? "");

      const rightTarget =
        right.resolution === "resolved"
          ? right.toFileId
          : (right.candidateRelativePath ?? right.specifier ?? "");

      return leftTarget.localeCompare(rightTarget);
    });

    for (const importEntry of sortedImports) {
      if (importEntry.resolution === "unresolved") {
        unresolvedImports += 1;
        continue;
      }

      if (
        !nodes.has(importEntry.fromFileId) ||
        !nodes.has(importEntry.toFileId)
      ) {
        omittedTargets += 1;
        continue;
      }

      this.addEdge(edgeState, {
        type: "imports",

        fromNodeId: importEntry.fromFileId,

        toNodeId: importEntry.toFileId,

        evidence: {
          source: "code_index_import",

          ...(importEntry.specifier
            ? {
                detail: importEntry.specifier,
              }
            : {
                detail: importEntry.resolvedRelativePath,
              }),
        },
      });
    }

    return {
      unresolvedImports,
      omittedTargets,
    };
  }

  private addReferenceEdges(
    references: readonly CodeIndexReference[],
    nodes: ReadonlyMap<string, RepoGraphNode>,
    edgeState: MutableEdgeState,
  ): {
    omittedTargets: number;
  } {
    let omittedTargets = 0;

    const sortedReferences = [...references].sort((left, right) => {
      const fromComparison = left.fromFileId.localeCompare(right.fromFileId);

      if (fromComparison !== 0) {
        return fromComparison;
      }

      const symbolComparison = left.symbolName.localeCompare(right.symbolName);

      if (symbolComparison !== 0) {
        return symbolComparison;
      }

      return (left.toSymbolId ?? left.toFileId ?? "").localeCompare(
        right.toSymbolId ?? right.toFileId ?? "",
      );
    });

    for (const reference of sortedReferences) {
      const targetNodeId = this.resolveReferenceTarget(reference, nodes);

      if (!nodes.has(reference.fromFileId) || !targetNodeId) {
        omittedTargets += 1;
        continue;
      }

      this.addEdge(edgeState, {
        type: "references",

        fromNodeId: reference.fromFileId,

        toNodeId: targetNodeId,

        evidence: {
          source: "code_index_reference",

          detail: reference.symbolName,
        },
      });
    }

    return {
      omittedTargets,
    };
  }

  private addProjectRelationships(
    relationships: readonly ProjectRelationship[],
    nodes: ReadonlyMap<string, RepoGraphNode>,
    edgeState: MutableEdgeState,
    warnings: RepoGraphWarning[],
  ): void {
    const supportedTypes = new Set<string>(
      REPO_GRAPH_PROJECT_RELATIONSHIP_TYPES,
    );

    const sortedRelationships = [...relationships].sort((left, right) =>
      [left.fromProjectId, left.toProjectId, left.type]
        .join("\u0000")
        .localeCompare(
          [right.fromProjectId, right.toProjectId, right.type].join("\u0000"),
        ),
    );

    for (const relationship of sortedRelationships) {
      if (!supportedTypes.has(relationship.type)) {
        continue;
      }

      const fromNodeId = this.createProjectNodeId(relationship.fromProjectId);

      const toNodeId = this.createProjectNodeId(relationship.toProjectId);

      if (!nodes.has(fromNodeId) || !nodes.has(toNodeId)) {
        warnings.push({
          code: "project_relationship_target_missing",

          message:
            `Project relationship ` +
            `"${relationship.fromProjectId}" → ` +
            `"${relationship.toProjectId}" was omitted ` +
            "because one or both projects are outside the graph scope.",
        });

        continue;
      }

      this.addEdge(edgeState, {
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

  private addEdge(
    state: MutableEdgeState,
    input: {
      type: RepoGraphEdgeType;
      fromNodeId: string;
      toNodeId: string;
      evidence: RepoGraphEdgeEvidence;
    },
  ): void {
    const key = [input.type, input.fromNodeId, input.toNodeId].join("\u0000");

    const existing = state.edges.get(key);

    if (existing) {
      existing.weight += 1;

      if (
        existing.evidence.length < this.options.maximumEvidencePerEdge &&
        !this.hasEquivalentEvidence(existing.evidence, input.evidence)
      ) {
        existing.evidence.push(input.evidence);
      }

      return;
    }

    if (state.edges.size >= this.options.maximumEdges) {
      state.truncated = true;
      return;
    }

    state.edges.set(key, {
      id: this.createEdgeId(input.type, input.fromNodeId, input.toNodeId),

      type: input.type,

      fromNodeId: input.fromNodeId,

      toNodeId: input.toNodeId,

      weight: 1,

      evidence: [input.evidence],
    });
  }

  private resolveReferenceTarget(
    reference: CodeIndexReference,
    nodes: ReadonlyMap<string, RepoGraphNode>,
  ): string | undefined {
    if (reference.toSymbolId && nodes.has(reference.toSymbolId)) {
      return reference.toSymbolId;
    }

    if (reference.toFileId && nodes.has(reference.toFileId)) {
      return reference.toFileId;
    }

    return undefined;
  }

  private findOwningProject(
    file: CodeIndexFile,
    projects: readonly ProjectDefinition[],
  ): ProjectDefinition | undefined {
    const candidates = projects
      .filter(
        (project) =>
          project.rootId === file.rootId &&
          this.isWithinProject(file.relativePath, project.relativeRoot),
      )
      .sort(
        (left, right) =>
          right.relativeRoot.length - left.relativeRoot.length ||
          left.id.localeCompare(right.id),
      );

    return candidates[0];
  }

  private isWithinProject(relativePath: string, relativeRoot: string): boolean {
    const path = this.normalizeRelativePath(relativePath);

    const root = this.normalizeRelativePath(relativeRoot);

    if (!root) {
      return true;
    }

    return path === root || path.startsWith(`${root}/`);
  }

  private finalizeGraph(input: {
    input: RepoGraphBuildInput;
    attempt: RepoGraphBuildAttempt;
    changeToken: string;
    consistencyRetries: number;
    durationMs: number;
    indexChanged: boolean;
  }): RepoGraph {
    const warnings = [...input.attempt.warnings];

    if (input.indexChanged) {
      warnings.push({
        code: "code_index_changed_during_build",

        message:
          "The Code Index changed during Repo Graph construction. " +
          "The returned graph may represent a partial index state.",
      });
    }

    const status =
      input.attempt.fileResult.truncated ||
      input.attempt.edgesTruncated ||
      input.indexChanged
        ? "partial"
        : "complete";

    const statistics = this.buildStatistics(
      input.attempt,
      input.consistencyRetries,
      input.durationMs,
    );

    const graph: RepoGraph = {
      schemaVersion: REPO_GRAPH_SCHEMA_VERSION,

      workspaceSnapshotId: input.input.snapshot.snapshotId,

      codeIndexChangeToken: input.changeToken,

      nodes: input.attempt.nodes,

      edges: input.attempt.edges,

      warnings,

      statistics,

      status,

      generatedAt: new Date().toISOString(),
    };

    return repoGraphSchema.parse(graph) as RepoGraph;
  }

  private buildStatistics(
    attempt: RepoGraphBuildAttempt,
    consistencyRetries: number,
    durationMs: number,
  ): RepoGraphStatistics {
    const countNodes = (kind: RepoGraphNode["kind"]): number =>
      attempt.nodes.filter((node) => node.kind === kind).length;

    const countEdges = (...types: RepoGraphEdgeType[]): number => {
      const accepted = new Set(types);

      return attempt.edges.filter((edge) => accepted.has(edge.type)).length;
    };

    return {
      availableFiles: attempt.fileResult.totalAvailable,

      indexedFiles: attempt.fileResult.files.length,

      projectNodes: countNodes("project"),

      fileNodes: countNodes("file"),

      symbolNodes: countNodes("symbol"),

      containsEdges: countEdges("contains"),

      declaresEdges: countEdges("declares"),

      importEdges: countEdges("imports"),

      referenceEdges: countEdges("references"),

      projectRelationshipEdges: countEdges(
        "workspace_member",
        "depends_on",
        "development_depends_on",
      ),

      unresolvedImports: attempt.unresolvedImports,

      omittedImportTargets: attempt.omittedImportTargets,

      omittedReferenceTargets: attempt.omittedReferenceTargets,

      consistencyRetries,

      durationMs: Math.max(0, durationMs),
    };
  }

  private createProjectNodeId(projectId: string): string {
    return (
      `${REPO_GRAPH_NODE_PREFIXES.PROJECT}:` +
      `${encodeURIComponent(projectId)}`
    );
  }

  private createEdgeId(
    type: RepoGraphEdgeType,
    fromNodeId: string,
    toNodeId: string,
  ): string {
    return [
      REPO_GRAPH_EDGE_PREFIX,
      type,
      encodeURIComponent(fromNodeId),
      encodeURIComponent(toNodeId),
    ].join(":");
  }

  private hasEquivalentEvidence(
    existing: readonly RepoGraphEdgeEvidence[],
    candidate: RepoGraphEdgeEvidence,
  ): boolean {
    return existing.some(
      (evidence) =>
        evidence.source === candidate.source &&
        evidence.detail === candidate.detail,
    );
  }

  private normalizeRelativePath(value: string): string {
    return value
      .trim()
      .replace(/\\/g, "/")
      .replace(/^\.\/+/, "")
      .replace(/\/+/g, "/")
      .replace(/\/+$/, "");
  }

  private compareFiles(left: CodeIndexFile, right: CodeIndexFile): number {
    return (
      left.rootId.localeCompare(right.rootId) ||
      left.relativePath.localeCompare(right.relativePath) ||
      left.id.localeCompare(right.id)
    );
  }

  private compareProjects(
    left: ProjectDefinition,
    right: ProjectDefinition,
  ): number {
    return (
      left.rootId.localeCompare(right.rootId) ||
      left.relativeRoot.localeCompare(right.relativeRoot) ||
      left.id.localeCompare(right.id)
    );
  }

  private compareSymbols(
    left: CodeIndexSymbol,
    right: CodeIndexSymbol,
  ): number {
    return (
      (left.startLine ?? 0) - (right.startLine ?? 0) ||
      left.name.localeCompare(right.name) ||
      left.id.localeCompare(right.id)
    );
  }

  private compareNodes(left: RepoGraphNode, right: RepoGraphNode): number {
    const kindOrder: Readonly<Record<RepoGraphNode["kind"], number>> = {
      project: 10,
      file: 20,
      symbol: 30,
    };

    return (
      kindOrder[left.kind] - kindOrder[right.kind] ||
      left.id.localeCompare(right.id)
    );
  }

  private compareEdges(left: RepoGraphEdge, right: RepoGraphEdge): number {
    return (
      REPO_GRAPH_EDGE_ORDER[left.type] - REPO_GRAPH_EDGE_ORDER[right.type] ||
      left.fromNodeId.localeCompare(right.fromNodeId) ||
      left.toNodeId.localeCompare(right.toNodeId) ||
      left.id.localeCompare(right.id)
    );
  }

  private validateInput(input: RepoGraphBuildInput): void {
    if (input.catalog.workspaceSnapshotId !== input.snapshot.snapshotId) {
      throw new Error(
        "ProjectCatalog.workspaceSnapshotId must match " +
          "WorkspaceSnapshot.snapshotId.",
      );
    }

    if (input.rootIds) {
      const uniqueRootIds = new Set(input.rootIds);

      if (uniqueRootIds.size !== input.rootIds.length) {
        throw new RangeError("RepoGraphBuildInput.rootIds must be unique.");
      }

      const snapshotRootIds = new Set(
        input.snapshot.roots.map((root) => root.id),
      );

      for (const rootId of input.rootIds) {
        if (!snapshotRootIds.has(rootId)) {
          throw new RangeError(`Unknown workspace root ID "${rootId}".`);
        }
      }
    }
  }

  private validateOptions(): void {
    this.validatePositiveInteger("maximumFiles", this.options.maximumFiles);

    this.validatePositiveInteger(
      "maximumSymbolsPerFile",
      this.options.maximumSymbolsPerFile,
    );

    this.validatePositiveInteger("maximumEdges", this.options.maximumEdges);

    this.validatePositiveInteger(
      "maximumEvidencePerEdge",
      this.options.maximumEvidencePerEdge,
    );

    if (
      !Number.isSafeInteger(this.options.maximumConsistencyRetries) ||
      this.options.maximumConsistencyRetries < 0
    ) {
      throw new RangeError(
        "maximumConsistencyRetries must be a non-negative safe integer.",
      );
    }
  }

  private validatePositiveInteger(name: string, value: number): void {
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new RangeError(`${name} must be a positive safe integer.`);
    }
  }
}
