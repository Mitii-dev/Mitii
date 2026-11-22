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
import {
  bucketSortKey,
  classifyImpactBucket,
} from "../internal/classifyImpactBucket";
import { collectBoundedChains } from "../internal/collectBoundedChains";
import {
  compareAffectedNodes,
  compareVisits,
  createFileIndex,
  createImportanceByNodeId,
  createInDegree,
  createNodeIndex,
  createProjectIndex,
  edgeTypeOrder,
  formatPathLabels,
  impactScore,
  isChangeImpactEdgeType,
} from "../internal/impactGraphHelpers";
import type {
  ChangeImpactEdge,
  ChangeImpactEdgeType,
  ImpactAdjacencyEdge,
  WalkVisit,
} from "../internal/impactTypes";
import { resolveSeedNodes } from "../internal/resolveSeedNodes";
import { walkBoundedDependents } from "../internal/walkBoundedDependents";
import { CHANGE_IMPACT_POLICY } from "../policy";
import type {
  RepoGraph,
  RepoGraphFileNode,
  RepoGraphNode,
} from "../../repository-state";

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

    const resolvedSeeds = resolveSeedNodes({
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
        chains: [],
        directNeighborCounts: { nodes: 0, files: 0 },
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
      maximumPaths: parsed.maximumPaths,
      nodeById,
      fileByFileId,
      importanceByRelativePath: parsed.importanceByRelativePath,
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
    const chains = this.toChains({
      rawChains: walk.chains,
      nodeById,
      fileByFileId,
    });
    const directNeighborCounts = this.countDirectNeighbors({
      visits: walk.visits,
      nodeById,
      fileByFileId,
    });

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
              ...(typeof node.startLine === "number"
                ? { startLine: node.startLine }
                : {}),
            }
          : {}),
      })),
      affected,
      affectedFiles,
      packagesAffected,
      chains,
      directNeighborCounts,
      truncated,
      warnings,
      reasonCodes: [...reasonCodes],
      graphRevision: graph.workspaceSnapshotId,
      codeIndexChangeToken: graph.codeIndexChangeToken,
    });
  }



  private walkImpact(params: {
    graph: RepoGraph;
    seedNodeIds: readonly string[];
    edgeTypes: readonly ChangeImpactEdgeType[];
    maximumHops: number;
    maximumAffectedNodes: number;
    maximumPaths: number;
    nodeById: ReadonlyMap<string, RepoGraphNode>;
    fileByFileId: ReadonlyMap<string, RepoGraphFileNode>;
    importanceByRelativePath?: Readonly<Record<string, number>>;
    reverse: boolean;
  }): {
    visits: WalkVisit[];
    chains: Array<{
      nodeIds: string[];
      hop: number;
      tipEdge: ChangeImpactEdge;
      score: number;
    }>;
    truncated: boolean;
    reasonCodes: ChangeImpactReasonCode[];
  } {
    const adjacency = this.createImpactAdjacency(params);
    const inDegree = createInDegree(adjacency);
    const importanceByNodeId = createImportanceByNodeId({
      nodeById: params.nodeById,
      fileByFileId: params.fileByFileId,
      importanceByRelativePath: params.importanceByRelativePath,
    });
    const scoreFn = (edge: ChangeImpactEdge, hop: number, nodeId: string) =>
      impactScore(
        edge,
        hop,
        inDegree.get(nodeId) ?? 0,
        importanceByNodeId.get(nodeId) ?? 0,
      );
    const walked = walkBoundedDependents({
      seedNodeIds: params.seedNodeIds,
      maximumHops: params.maximumHops,
      maximumAffectedNodes: params.maximumAffectedNodes,
      adjacency,
      nodeExists: (nodeId) => params.nodeById.has(nodeId),
      score: scoreFn,
      compareVisits,
    });
    const chained = collectBoundedChains({
      seedNodeIds: params.seedNodeIds,
      maximumHops: params.maximumHops,
      maximumPaths: params.maximumPaths,
      adjacency,
      nodeExists: (nodeId) => params.nodeById.has(nodeId),
      score: scoreFn,
    });
    return {
      visits: walked.visits,
      chains: chained.chains.map((chain) => ({
        nodeIds: chain.nodeIds,
        hop: chain.hop,
        tipEdge: chain.tipEdge as ChangeImpactEdge,
        score: chain.score,
      })),
      truncated: walked.truncated || chained.truncated,
      reasonCodes: [...walked.reasonCodes, ...chained.reasonCodes],
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

      const bucket = classifyImpactBucket(file.relativePath);
      const score =
        bucket === "test"
          ? Number(
              (visit.score * CHANGE_IMPACT_POLICY.testScoreFactor).toFixed(3),
            )
          : visit.score;

      const evidence: string[] = [];
      const chainLabel = formatPathLabels(
        visit.pathNodeIds,
        params.nodeById,
        params.fileByFileId,
      );
      if (chainLabel.length >= 2) {
        evidence.push(`chain: ${chainLabel.join(" → ")}`);
      }
      for (const item of visit.viaEdge.evidence.slice(0, 4)) {
        evidence.push(
          [item.source, item.detail, item.line ? `line ${item.line}` : undefined]
            .filter(Boolean)
            .join(": "),
        );
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
        score,
        evidence: evidence.slice(0, 5),
      });
    }

    affected.sort(compareAffectedNodes);
    return affected;
  }

  private toChains(params: {
    rawChains: readonly {
      nodeIds: string[];
      hop: number;
      tipEdge: ChangeImpactEdge;
      score: number;
    }[];
    nodeById: ReadonlyMap<string, RepoGraphNode>;
    fileByFileId: ReadonlyMap<string, RepoGraphFileNode>;
  }): ChangeImpactResult["chains"] {
    return params.rawChains.map((chain) => ({
      links: chain.nodeIds.map((nodeId) => {
        const node = params.nodeById.get(nodeId);
        if (!node || node.kind === "project") {
          return { nodeId };
        }
        const file =
          node.kind === "file" ? node : params.fileByFileId.get(node.fileId);
        return {
          nodeId,
          ...(file ? { relativePath: file.relativePath } : {}),
          ...(node.kind === "symbol" ? { symbolName: node.name } : {}),
        };
      }),
      hop: chain.hop,
      score: chain.score,
      viaEdgeType: chain.tipEdge.type,
    }));
  }

  private aggregateAffectedFiles(
    affected: ChangeImpactResult["affected"],
  ): ChangeImpactResult["affectedFiles"] {
    const byPath = new Map<string, ChangeImpactResult["affectedFiles"][number]>();
    for (const node of affected) {
      const bucket = classifyImpactBucket(node.relativePath);
      const current = byPath.get(node.relativePath);
      if (!current) {
        byPath.set(node.relativePath, {
          relativePath: node.relativePath,
          hop: node.hop,
          score: node.score,
          affectedNodeIds: [node.nodeId],
          reason: `${node.viaEdgeType} dependent at hop ${node.hop}`,
          bucket,
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
        bucketSortKey(left.bucket) - bucketSortKey(right.bucket) ||
        right.score - left.score ||
        left.relativePath.localeCompare(right.relativePath),
    );
  }

  private countDirectNeighbors(params: {
    visits: readonly WalkVisit[];
    nodeById: ReadonlyMap<string, RepoGraphNode>;
    fileByFileId: ReadonlyMap<string, RepoGraphFileNode>;
  }): ChangeImpactResult["directNeighborCounts"] {
    const hop1 = params.visits.filter((visit) => visit.hop === 1);
    const files = new Set<string>();
    let nodes = 0;
    for (const visit of hop1) {
      const node = params.nodeById.get(visit.nodeId);
      if (!node || node.kind === "project") continue;
      nodes += 1;
      const file =
        node.kind === "file" ? node : params.fileByFileId.get(node.fileId);
      if (file) files.add(file.relativePath);
    }
    return { nodes, files: files.size };
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


}
