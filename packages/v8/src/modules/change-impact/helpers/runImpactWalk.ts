import type {
  ChangeImpactReasonCode,
  ChangeImpactResult,
  ChangeImpactWarningCode,
} from "../types";
import {
  bucketSortKey,
  classifyImpactBucket,
} from "./classifyImpactBucket";
import {
  classifyImpactReason,
  describeImpactReason,
} from "./classifyImpactReason";
import { collectBoundedChains } from "./collectBoundedChains";
import {
  compareAffectedNodes,
  compareVisits,
  createImportanceByNodeId,
  createInDegree,
  edgeTypeOrder,
  formatPathLabels,
  impactScore,
  isChangeImpactEdgeType,
} from "./impactGraphHelpers";
import type {
  ChangeImpactEdge,
  ChangeImpactEdgeType,
  ImpactAdjacencyEdge,
  WalkVisit,
} from "./impactTypes";
import { walkBoundedDependents } from "./walkBoundedDependents";
import { CHANGE_IMPACT_POLICY } from "../rules";
import type {
  RepoGraph,
  RepoGraphFileNode,
  RepoGraphNode,
} from "../../repository-state";

export function runImpactWalk(params: {
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
  const adjacency = createImpactAdjacency(params);
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

export function toAffectedNodes(params: {
  visits: readonly WalkVisit[];
  nodeById: ReadonlyMap<string, RepoGraphNode>;
  fileByFileId: ReadonlyMap<string, RepoGraphFileNode>;
  warnings: Array<{ code: ChangeImpactWarningCode; message: string }>;
}): ChangeImpactResult["affected"] {
  const affected: ChangeImpactResult["affected"] = [];

  for (const visit of params.visits) {
    const node = params.nodeById.get(visit.nodeId);
    if (!node || node.kind === "project") continue;
    const file =
      node.kind === "file" ? node : params.fileByFileId.get(node.fileId);
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

export function toChains(params: {
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

export function aggregateAffectedFiles(
  affected: ChangeImpactResult["affected"],
): ChangeImpactResult["affectedFiles"] {
  const byPath = new Map<string, ChangeImpactResult["affectedFiles"][number]>();
  for (const node of affected) {
    const bucket = classifyImpactBucket(node.relativePath);
    const impactReason = classifyImpactReason({
      hop: node.hop,
      viaEdgeType: node.viaEdgeType,
    });
    const current = byPath.get(node.relativePath);
    if (!current) {
      byPath.set(node.relativePath, {
        relativePath: node.relativePath,
        hop: node.hop,
        score: node.score,
        affectedNodeIds: [node.nodeId],
        reason: describeImpactReason({
          impactReason,
          viaEdgeType: node.viaEdgeType,
          hop: node.hop,
        }),
        impactReason,
        bucket,
      });
      continue;
    }
    current.affectedNodeIds.push(node.nodeId);
    if (node.hop < current.hop) {
      current.hop = node.hop;
      current.impactReason = impactReason;
      current.reason = describeImpactReason({
        impactReason,
        viaEdgeType: node.viaEdgeType,
        hop: node.hop,
      });
    }
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

export function countDirectNeighbors(params: {
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

export function toAffectedPackages(params: {
  visits: readonly WalkVisit[];
  nodeById: ReadonlyMap<string, RepoGraphNode>;
  maximumPackages: number;
}): ChangeImpactResult["packagesAffected"] {
  const packages = new Map<
    string,
    ChangeImpactResult["packagesAffected"][number]
  >();
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

function createImpactAdjacency(params: {
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
