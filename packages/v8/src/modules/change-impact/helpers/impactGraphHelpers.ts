import type { ChangeImpactResult } from "../contracts";
import { CHANGE_IMPACT_POLICY } from "../rules";
import type {
  RepoGraph,
  RepoGraphEdge,
  RepoGraphEdgeType,
  RepoGraphFileNode,
  RepoGraphNode,
  RepoGraphSymbolNode,
} from "../../repository-state";
import {
  bucketSortKey,
  classifyImpactBucket,
} from "./classifyImpactBucket";
import type {
  ChangeImpactEdge,
  ChangeImpactEdgeType,
  ImpactAdjacencyEdge,
  RepoGraphProjectNode,
  WalkVisit,
} from "./impactTypes";

export function createNodeIndex(graph: RepoGraph): Map<string, RepoGraphNode> {
  const nodeById = new Map<string, RepoGraphNode>();
  for (const node of graph.nodes) {
    nodeById.set(node.id, node);
  }
  return nodeById;
}

export function createFileIndex(graph: RepoGraph): Map<string, RepoGraphFileNode> {
  const fileByFileId = new Map<string, RepoGraphFileNode>();
  for (const node of graph.nodes) {
    if (node.kind === "file") {
      fileByFileId.set(node.fileId, node);
    }
  }
  return fileByFileId;
}

export function createProjectIndex(graph: RepoGraph): Map<string, RepoGraphProjectNode> {
  const projectByProjectId = new Map<string, RepoGraphProjectNode>();
  for (const node of graph.nodes) {
    if (node.kind === "project") {
      projectByProjectId.set(node.projectId, node);
    }
  }
  return projectByProjectId;
}

export function createInDegree(
  adjacency: ReadonlyMap<string, readonly ImpactAdjacencyEdge[]>,
): Map<string, number> {
  const inDegree = new Map<string, number>();
  for (const neighbors of adjacency.values()) {
    for (const neighbor of neighbors) {
      inDegree.set(neighbor.nodeId, (inDegree.get(neighbor.nodeId) ?? 0) + 1);
    }
  }
  return inDegree;
}

/**
 * Prefer explicitly exported symbols; otherwise symbols that are targets of
 * inbound impact edges from outside the file. Never expands every symbol.
 */
export function selectExportSeeds(params: {
  symbolsInFile: readonly RepoGraphSymbolNode[];
  fileNodeId: string;
  edges: readonly RepoGraphEdge[];
}): RepoGraphSymbolNode[] {
  const exported = params.symbolsInFile.filter((node) => node.exported === true);
  if (exported.length > 0) {
    return exported;
  }

  const hasExportMetadata = params.symbolsInFile.some(
    (node) => typeof node.exported === "boolean",
  );
  if (hasExportMetadata) {
    // Symbols are known non-exported; keep file-only.
    return [];
  }

  const symbolIds = new Set(params.symbolsInFile.map((node) => node.id));
  const externalTargets = new Set<string>();
  for (const edge of params.edges) {
    if (
      !isChangeImpactEdgeType(edge.type) ||
      !CHANGE_IMPACT_POLICY.reverseEdgeTypes.has(edge.type)
    ) {
      continue;
    }
    if (!symbolIds.has(edge.toNodeId)) continue;
    if (symbolIds.has(edge.fromNodeId) || edge.fromNodeId === params.fileNodeId) {
      continue;
    }
    externalTargets.add(edge.toNodeId);
  }

  return params.symbolsInFile.filter((node) => externalTargets.has(node.id));
}

export function normalizeRelativePath(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\.\//, "");
}

export function coversLine(node: RepoGraphSymbolNode, line: number): boolean {
  const start = node.startLine ?? 1;
  const end = node.endLine ?? start;
  return line >= start && line <= end;
}

export function symbolSpan(node: RepoGraphSymbolNode): number {
  return (node.endLine ?? node.startLine ?? 1) - (node.startLine ?? 1);
}

const EDGE_TYPE_WALK_ORDER: readonly RepoGraphEdgeType[] = [
  ...CHANGE_IMPACT_POLICY.defaultEdgeTypes,
  "development_depends_on",
  "workspace_member",
];

export function edgeTypeOrder(edgeType: RepoGraphEdgeType): number {
  const order = EDGE_TYPE_WALK_ORDER.indexOf(edgeType);
  return order >= 0 ? order : Number.MAX_SAFE_INTEGER;
}

export function createImportanceByNodeId(params: {
  nodeById: ReadonlyMap<string, RepoGraphNode>;
  fileByFileId: ReadonlyMap<string, RepoGraphFileNode>;
  importanceByRelativePath?: Readonly<Record<string, number>>;
}): Map<string, number> {
  const map = new Map<string, number>();
  if (!params.importanceByRelativePath) return map;
  for (const node of params.nodeById.values()) {
    if (node.kind === "project") continue;
    const file =
      node.kind === "file" ? node : params.fileByFileId.get(node.fileId);
    if (!file) continue;
    const key = normalizeRelativePath(file.relativePath);
    const value =
      params.importanceByRelativePath[key] ??
      params.importanceByRelativePath[file.relativePath];
    if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
      map.set(node.id, value);
    }
  }
  return map;
}

export function impactScore(
  edge: ChangeImpactEdge,
  hop: number,
  fanIn: number,
  importance = 0,
): number {
  const edgeFactor = CHANGE_IMPACT_POLICY.edgeTypeScore[edge.type] ?? 0.5;
  const base = (edge.weight * edgeFactor) / hop;
  const fanInBoost =
    1 +
    Math.min(CHANGE_IMPACT_POLICY.fanInCap, Math.max(0, fanIn)) *
      CHANGE_IMPACT_POLICY.fanInWeight;
  const evidenceBoost =
    1 +
    Math.min(
      CHANGE_IMPACT_POLICY.evidenceCap,
      Math.max(0, edge.evidenceCount),
    ) *
      CHANGE_IMPACT_POLICY.evidenceWeight;
  const pageRankBoost =
    1 +
    Math.min(CHANGE_IMPACT_POLICY.pageRankCap, Math.max(0, importance)) *
      CHANGE_IMPACT_POLICY.pageRankWeight;
  return Number((base * fanInBoost * evidenceBoost * pageRankBoost).toFixed(3));
}

export function isChangeImpactEdgeType(
  edgeType: RepoGraphEdgeType,
): edgeType is ChangeImpactEdgeType {
  return CHANGE_IMPACT_POLICY.reverseEdgeTypes.has(edgeType);
}

export function compareVisits(left: WalkVisit, right: WalkVisit): number {
  return (
    left.hop - right.hop ||
    right.score - left.score ||
    left.nodeId.localeCompare(right.nodeId) ||
    left.viaEdge.id.localeCompare(right.viaEdge.id)
  );
}

export function compareAffectedNodes(
  left: ChangeImpactResult["affected"][number],
  right: ChangeImpactResult["affected"][number],
): number {
  return (
    left.hop - right.hop ||
    bucketSortKey(classifyImpactBucket(left.relativePath)) -
      bucketSortKey(classifyImpactBucket(right.relativePath)) ||
    right.score - left.score ||
    left.relativePath.localeCompare(right.relativePath) ||
    (left.symbolName ?? "").localeCompare(right.symbolName ?? "") ||
    left.nodeId.localeCompare(right.nodeId)
  );
}

export function formatPathLabels(
  pathNodeIds: readonly string[],
  nodeById: ReadonlyMap<string, RepoGraphNode>,
  fileByFileId: ReadonlyMap<string, RepoGraphFileNode>,
): string[] {
  const labels: string[] = [];
  for (const nodeId of pathNodeIds) {
    const node = nodeById.get(nodeId);
    if (!node || node.kind === "project") continue;
    if (node.kind === "symbol") {
      const file = fileByFileId.get(node.fileId);
      labels.push(
        file
          ? `${file.relativePath}:${node.name}`
          : node.name,
      );
      continue;
    }
    labels.push(node.relativePath);
  }
  return labels;
}
