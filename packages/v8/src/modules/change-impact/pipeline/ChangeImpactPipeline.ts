import {
  CHANGE_IMPACT_SCHEMA_VERSION,
} from "../constants";
import {
  ChangeImpactError,
  changeImpactInputSchema,
  changeImpactResultSchema,
} from "../contracts";
import type {
  ChangeImpactParsedInput,
  ChangeImpactReasonCode,
  ChangeImpactResult,
  ChangeImpactWarningCode,
} from "../contracts";
import { walkBoundedDependents } from "../internal/walkBoundedDependents";
import { CHANGE_IMPACT_POLICY } from "../policy";
import type {
  RepoGraph,
  RepoGraphEdge,
  RepoGraphEdgeType,
  RepoGraphFileNode,
  RepoGraphNode,
  RepoGraphSymbolNode,
} from "../../repository-state";

type RepoGraphProjectNode = Extract<RepoGraphNode, { kind: "project" }>;
type ChangeImpactEdgeType = ChangeImpactParsedInput["edgeTypes"][number];
type ChangeImpactEdge = RepoGraphEdge & { type: ChangeImpactEdgeType };

interface ResolvedSeedNode {
  node: RepoGraphFileNode | RepoGraphSymbolNode | RepoGraphProjectNode;
  file?: RepoGraphFileNode;
}

interface WalkVisit {
  nodeId: string;
  hop: number;
  viaEdge: ChangeImpactEdge;
  score: number;
}

interface ImpactAdjacencyEdge {
  nodeId: string;
  edge: ChangeImpactEdge;
}

/**
 * Answers blast-radius questions over a published RepoGraph.
 * Edges are recorded dependent → dependency. `dependents` walks them in
 * reverse (who points at the seed). `dependencies` walks them forward
 * (what the seed imports / depends on).
 */
export class ChangeImpactPipeline {
  public analyze(input: ChangeImpactParsedInput | unknown): ChangeImpactResult {
    let parsed: ChangeImpactParsedInput;
    try {
      parsed = changeImpactInputSchema.parse(input);
    } catch (error) {
      throw new ChangeImpactError(
        "invalid_input",
        "Change impact input failed schema validation.",
        {
          cause: error instanceof Error ? error.message : String(error),
        },
      );
    }

    const graph = parsed.repoGraph;
    const nodeById = createNodeIndex(graph);
    const fileByFileId = createFileIndex(graph);
    const projectByProjectId = createProjectIndex(graph);
    const warnings: Array<{
      code: ChangeImpactWarningCode;
      message: string;
    }> = [];
    const reasonCodes = new Set<ChangeImpactReasonCode>();
    let truncated = false;

    if (graph.status === "partial") {
      warnings.push({
        code: "graph_partial",
        message: "Repository graph was built partially; impact may be incomplete.",
      });
    }

    if (
      parsed.codeIndexChangeToken &&
      parsed.codeIndexChangeToken !== graph.codeIndexChangeToken
    ) {
      reasonCodes.add("graph_stale");
    }

    const resolvedSeeds = this.resolveSeed({
      input: parsed,
      nodeById,
      fileByFileId,
      projectByProjectId,
      warnings,
      reasonCodes,
    });

    if (resolvedSeeds.length === 0) {
      reasonCodes.add("seed_unresolved");
      return changeImpactResultSchema.parse({
        schemaVersion: CHANGE_IMPACT_SCHEMA_VERSION,
        status:
          reasonCodes.has("graph_stale") || graph.status === "partial"
            ? "partial"
            : "empty",
        direction: parsed.direction,
        seed: parsed.seed,
        resolvedSeeds: [],
        affected: [],
        affectedFiles: [],
        packagesAffected: [],
        truncated: false,
        warnings,
        reasonCodes: [...reasonCodes],
        graphRevision: graph.workspaceSnapshotId,
        codeIndexChangeToken: graph.codeIndexChangeToken,
      });
    }

    const walk = this.walkImpact({
      graph,
      seedNodeIds: resolvedSeeds.map((seed) => seed.node.id),
      edgeTypes: parsed.edgeTypes,
      maximumHops: parsed.maximumHops,
      maximumAffectedNodes: parsed.maximumAffectedNodes,
      nodeById,
      reverse: parsed.direction !== "dependencies",
    });
    truncated = walk.truncated;
    for (const code of walk.reasonCodes) {
      reasonCodes.add(code);
    }

    const affected = this.toAffectedNodes({
      visits: walk.visits,
      nodeById,
      fileByFileId,
      graph,
      warnings,
    });
    const affectedFiles = this.aggregateAffectedFiles(affected);
    const packagesAffected = parsed.includePackages
      ? this.toAffectedPackages({
          visits: walk.visits,
          nodeById,
          maximumPackages: CHANGE_IMPACT_POLICY.maximumPackages,
        })
      : [];

    if (affected.length > 0 || packagesAffected.length > 0) {
      reasonCodes.add("impact_resolved");
    } else {
      reasonCodes.add(
        parsed.direction === "dependencies"
          ? "no_dependencies"
          : "no_dependents",
      );
    }

    const status =
      truncated || reasonCodes.has("graph_stale") || graph.status === "partial"
        ? "partial"
        : affected.length > 0 || packagesAffected.length > 0
          ? "ok"
          : "empty";

    return changeImpactResultSchema.parse({
      schemaVersion: CHANGE_IMPACT_SCHEMA_VERSION,
      status,
      direction: parsed.direction,
      seed: parsed.seed,
      resolvedSeeds: resolvedSeeds.map(({ node, file }) => ({
        nodeId: node.id,
        kind: node.kind,
        ...(file ? { relativePath: file.relativePath } : {}),
        ...(node.kind === "file" ? { relativePath: node.relativePath } : {}),
        ...(node.kind === "symbol"
          ? {
              symbolName: node.name,
              symbolKind: node.symbolKind,
            }
          : {}),
      })),
      affected,
      affectedFiles,
      packagesAffected,
      truncated,
      warnings,
      reasonCodes: [...reasonCodes],
      graphRevision: graph.workspaceSnapshotId,
      codeIndexChangeToken: graph.codeIndexChangeToken,
    });
  }

  private resolveSeed(params: {
    input: ChangeImpactParsedInput;
    nodeById: ReadonlyMap<string, RepoGraphNode>;
    fileByFileId: ReadonlyMap<string, RepoGraphFileNode>;
    projectByProjectId: ReadonlyMap<string, RepoGraphProjectNode>;
    warnings: Array<{ code: ChangeImpactWarningCode; message: string }>;
    reasonCodes: Set<ChangeImpactReasonCode>;
  }): ResolvedSeedNode[] {
    const seed = params.input.seed;
    const file = this.findFile(params.fileByFileId, seed.relativePath, seed.rootId);
    if (!file) return [];

    if (seed.kind === "file") {
      return this.expandFileSeed({
        file,
        input: params.input,
        nodeById: params.nodeById,
        projectByProjectId: params.projectByProjectId,
      });
    }

    const symbols = [...params.nodeById.values()].filter(
      (node): node is RepoGraphSymbolNode =>
        node.kind === "symbol" &&
        node.fileId === file.fileId &&
        (seed.kind === "caret"
          ? this.symbolMatchesCaret(node, seed.line, seed.symbolName)
          : node.name === seed.symbolName) &&
        (seed.kind !== "symbol" ||
          seed.startLine === undefined ||
          node.startLine === seed.startLine),
    );

    const selected =
      seed.kind === "caret"
        ? symbols.sort((left, right) => symbolSpan(left) - symbolSpan(right)).slice(0, 1)
        : symbols;

    if (selected.length > 1) {
      params.reasonCodes.add("seed_ambiguous");
    }

    if (selected.length === 0) {
      params.warnings.push({
        code: "seed_file_only",
        message:
          "Seed symbol was not resolved; falling back to file-level impact.",
      });
      return this.expandFileSeed({
        file,
        input: params.input,
        nodeById: params.nodeById,
        projectByProjectId: params.projectByProjectId,
      });
    }

    const seeds: ResolvedSeedNode[] = selected.map((node) => ({ node, file }));
    const project = file.projectId
      ? params.projectByProjectId.get(file.projectId)
      : undefined;
    if (params.input.includePackages && project) {
      seeds.push({ node: project });
    }
    return seeds;
  }

  private expandFileSeed(params: {
    file: RepoGraphFileNode;
    input: ChangeImpactParsedInput;
    nodeById: ReadonlyMap<string, RepoGraphNode>;
    projectByProjectId: ReadonlyMap<string, RepoGraphProjectNode>;
  }): ResolvedSeedNode[] {
    const seeds: ResolvedSeedNode[] = [{ node: params.file, file: params.file }];
    for (const node of params.nodeById.values()) {
      if (node.kind === "symbol" && node.fileId === params.file.fileId) {
        seeds.push({ node, file: params.file });
      }
    }
    const project = params.file.projectId
      ? params.projectByProjectId.get(params.file.projectId)
      : undefined;
    if (params.input.includePackages && project) {
      seeds.push({ node: project });
    }
    return seeds;
  }

  private walkImpact(params: {
    graph: RepoGraph;
    seedNodeIds: readonly string[];
    edgeTypes: readonly ChangeImpactEdgeType[];
    maximumHops: number;
    maximumAffectedNodes: number;
    nodeById: ReadonlyMap<string, RepoGraphNode>;
    reverse: boolean;
  }): {
    visits: WalkVisit[];
    truncated: boolean;
    reasonCodes: ChangeImpactReasonCode[];
  } {
    const adjacency = this.createImpactAdjacency(params);
    const walked = walkBoundedDependents({
      seedNodeIds: params.seedNodeIds,
      maximumHops: params.maximumHops,
      maximumAffectedNodes: params.maximumAffectedNodes,
      adjacency,
      nodeExists: (nodeId) => params.nodeById.has(nodeId),
      score: impactScore,
      compareVisits,
    });
    return {
      visits: walked.visits,
      truncated: walked.truncated,
      reasonCodes: walked.reasonCodes,
    };
  }

  private createImpactAdjacency(params: {
    graph: RepoGraph;
    edgeTypes: readonly ChangeImpactEdgeType[];
    nodeById: ReadonlyMap<string, RepoGraphNode>;
    reverse: boolean;
  }): ReadonlyMap<string, readonly ImpactAdjacencyEdge[]> {
    const edgeTypes = new Set<ChangeImpactEdgeType>(params.edgeTypes);
    const adjacency = new Map<string, ImpactAdjacencyEdge[]>();

    for (const edge of params.graph.edges) {
      if (
        !isChangeImpactEdgeType(edge.type) ||
        !edgeTypes.has(edge.type) ||
        !CHANGE_IMPACT_POLICY.reverseEdgeTypes.has(edge.type) ||
        !params.nodeById.has(edge.fromNodeId) ||
        !params.nodeById.has(edge.toNodeId)
      ) {
        continue;
      }
      const impactEdge = edge as ChangeImpactEdge;
      const fromId = params.reverse
        ? impactEdge.toNodeId
        : impactEdge.fromNodeId;
      const toId = params.reverse
        ? impactEdge.fromNodeId
        : impactEdge.toNodeId;
      const neighbors = adjacency.get(fromId) ?? [];
      neighbors.push({ nodeId: toId, edge: impactEdge });
      adjacency.set(fromId, neighbors);
    }

    for (const neighbors of adjacency.values()) {
      neighbors.sort(
        (left, right) =>
          edgeTypeOrder(left.edge.type) - edgeTypeOrder(right.edge.type) ||
          right.edge.weight - left.edge.weight ||
          left.nodeId.localeCompare(right.nodeId) ||
          left.edge.id.localeCompare(right.edge.id),
      );
    }

    return adjacency;
  }

  private toAffectedNodes(params: {
    visits: readonly WalkVisit[];
    nodeById: ReadonlyMap<string, RepoGraphNode>;
    fileByFileId: ReadonlyMap<string, RepoGraphFileNode>;
    graph: RepoGraph;
    warnings: Array<{ code: ChangeImpactWarningCode; message: string }>;
  }): ChangeImpactResult["affected"] {
    const affected: ChangeImpactResult["affected"] = [];

    for (const visit of params.visits) {
      const node = params.nodeById.get(visit.nodeId);
      if (!node || node.kind === "project") continue;
      const file = node.kind === "file" ? node : params.fileByFileId.get(node.fileId);
      if (!file) continue;

      if (visit.viaEdge.evidenceTruncated) {
        params.warnings.push({
          code: "evidence_truncated",
          message: `Graph evidence for edge ${visit.viaEdge.id} was truncated.`,
        });
      }

      affected.push({
        nodeId: node.id,
        kind: node.kind,
        relativePath: file.relativePath,
        ...(node.kind === "symbol"
          ? {
              symbolName: node.name,
              symbolKind: node.symbolKind,
            }
          : {}),
        hop: visit.hop,
        viaEdgeType: visit.viaEdge.type,
        viaEdgeId: visit.viaEdge.id,
        score: visit.score,
        evidence: visit.viaEdge.evidence
          .slice(0, 5)
          .map((evidence) =>
            [
              evidence.source,
              evidence.detail,
              evidence.line ? `line ${evidence.line}` : undefined,
            ]
              .filter(Boolean)
              .join(": "),
          ),
      });
    }

    affected.sort(compareAffectedNodes);
    return affected;
  }

  private aggregateAffectedFiles(
    affected: ChangeImpactResult["affected"],
  ): ChangeImpactResult["affectedFiles"] {
    const byPath = new Map<string, ChangeImpactResult["affectedFiles"][number]>();
    for (const node of affected) {
      const current = byPath.get(node.relativePath);
      if (!current) {
        byPath.set(node.relativePath, {
          relativePath: node.relativePath,
          hop: node.hop,
          score: node.score,
          affectedNodeIds: [node.nodeId],
          reason: `${node.viaEdgeType} dependent at hop ${node.hop}`,
        });
        continue;
      }
      current.affectedNodeIds.push(node.nodeId);
      current.hop = Math.min(current.hop, node.hop);
      current.score = Math.max(current.score, node.score);
    }
    return [...byPath.values()].sort(
      (left, right) =>
        left.hop - right.hop ||
        right.score - left.score ||
        left.relativePath.localeCompare(right.relativePath),
    );
  }

  private toAffectedPackages(params: {
    visits: readonly WalkVisit[];
    nodeById: ReadonlyMap<string, RepoGraphNode>;
    maximumPackages: number;
  }): ChangeImpactResult["packagesAffected"] {
    const packages = new Map<string, ChangeImpactResult["packagesAffected"][number]>();
    for (const visit of params.visits) {
      const node = params.nodeById.get(visit.nodeId);
      if (!node || node.kind !== "project") continue;
      const current = packages.get(node.projectId);
      if (!current || visit.hop < current.hop) {
        packages.set(node.projectId, {
          projectId: node.projectId,
          name: node.name,
          hop: visit.hop,
          viaEdgeType: visit.viaEdge.type,
        });
      }
    }
    return [...packages.values()]
      .sort(
        (left, right) =>
          left.hop - right.hop ||
          left.name.localeCompare(right.name) ||
          left.projectId.localeCompare(right.projectId),
      )
      .slice(0, params.maximumPackages);
  }

  private findFile(
    fileByFileId: ReadonlyMap<string, RepoGraphFileNode>,
    relativePath: string,
    rootId?: string,
  ): RepoGraphFileNode | undefined {
    const normalized = normalizeRelativePath(relativePath);
    return [...fileByFileId.values()].find(
      (file) =>
        normalizeRelativePath(file.relativePath) === normalized &&
        (!rootId || file.rootId === rootId),
    );
  }

  private symbolMatchesCaret(
    node: RepoGraphSymbolNode,
    line: number,
    symbolName?: string,
  ): boolean {
    if (symbolName && node.name !== symbolName) {
      return false;
    }
    return coversLine(node, line);
  }
}

function createNodeIndex(graph: RepoGraph): Map<string, RepoGraphNode> {
  const nodeById = new Map<string, RepoGraphNode>();
  for (const node of graph.nodes) {
    nodeById.set(node.id, node);
  }
  return nodeById;
}

function createFileIndex(graph: RepoGraph): Map<string, RepoGraphFileNode> {
  const fileByFileId = new Map<string, RepoGraphFileNode>();
  for (const node of graph.nodes) {
    if (node.kind === "file") {
      fileByFileId.set(node.fileId, node);
    }
  }
  return fileByFileId;
}

function createProjectIndex(graph: RepoGraph): Map<string, RepoGraphProjectNode> {
  const projectByProjectId = new Map<string, RepoGraphProjectNode>();
  for (const node of graph.nodes) {
    if (node.kind === "project") {
      projectByProjectId.set(node.projectId, node);
    }
  }
  return projectByProjectId;
}

function normalizeRelativePath(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\.\//, "");
}

function coversLine(node: RepoGraphSymbolNode, line: number): boolean {
  const start = node.startLine ?? 1;
  const end = node.endLine ?? start;
  return line >= start && line <= end;
}

function symbolSpan(node: RepoGraphSymbolNode): number {
  return (node.endLine ?? node.startLine ?? 1) - (node.startLine ?? 1);
}

function edgeTypeOrder(edgeType: RepoGraphEdgeType): number {
  const order = CHANGE_IMPACT_POLICY.defaultEdgeTypes.indexOf(
    edgeType as (typeof CHANGE_IMPACT_POLICY.defaultEdgeTypes)[number],
  );
  return order >= 0 ? order : Number.MAX_SAFE_INTEGER;
}

function impactScore(edge: ChangeImpactEdge, hop: number): number {
  const edgeFactor = CHANGE_IMPACT_POLICY.edgeTypeScore[edge.type] ?? 0.5;
  return Number(((edge.weight * edgeFactor) / hop).toFixed(3));
}

function isChangeImpactEdgeType(
  edgeType: RepoGraphEdgeType,
): edgeType is ChangeImpactEdgeType {
  return CHANGE_IMPACT_POLICY.reverseEdgeTypes.has(edgeType);
}

function compareVisits(left: WalkVisit, right: WalkVisit): number {
  return (
    left.hop - right.hop ||
    right.score - left.score ||
    left.nodeId.localeCompare(right.nodeId) ||
    left.viaEdge.id.localeCompare(right.viaEdge.id)
  );
}

function compareAffectedNodes(
  left: ChangeImpactResult["affected"][number],
  right: ChangeImpactResult["affected"][number],
): number {
  return (
    left.hop - right.hop ||
    right.score - left.score ||
    left.relativePath.localeCompare(right.relativePath) ||
    (left.symbolName ?? "").localeCompare(right.symbolName ?? "") ||
    left.nodeId.localeCompare(right.nodeId)
  );
}
