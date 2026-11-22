import type {
  RepoGraph,
  RepoGraphFileNode,
  RepoGraphNode,
} from "../../repository-state";
import { CHANGE_IMPACT_POLICY } from "../policy";
import type { ChangeImpactEdgeType } from "./impactTypes";
import { isChangeImpactEdgeType } from "./impactGraphHelpers";

/**
 * Detect short file-level cycles that touch at least one seed file.
 * Uses a bounded DFS; does not invent edges.
 */
export function detectSeedCycles(params: {
  graph: RepoGraph;
  seedNodeIds: readonly string[];
  edgeTypes: readonly ChangeImpactEdgeType[];
  nodeById: ReadonlyMap<string, RepoGraphNode>;
  fileByFileId: ReadonlyMap<string, RepoGraphFileNode>;
}): string[][] {
  const seedFiles = new Set<string>();
  for (const nodeId of params.seedNodeIds) {
    const path = filePathForNode(nodeId, params.nodeById, params.fileByFileId);
    if (path) seedFiles.add(path);
  }
  if (seedFiles.size === 0) return [];

  const adjacency = buildFileAdjacency(params);
  const cycles: string[][] = [];
  const seenCycleKeys = new Set<string>();

  for (const start of [...seedFiles].sort()) {
    if (cycles.length >= CHANGE_IMPACT_POLICY.maxCycles) break;
    dfsCycles({
      start,
      current: start,
      path: [start],
      pathSet: new Set([start]),
      adjacency,
      seedFiles,
      cycles,
      seenCycleKeys,
    });
  }

  return cycles;
}

function dfsCycles(params: {
  start: string;
  current: string;
  path: string[];
  pathSet: Set<string>;
  adjacency: ReadonlyMap<string, readonly string[]>;
  seedFiles: ReadonlySet<string>;
  cycles: string[][];
  seenCycleKeys: Set<string>;
}): void {
  if (params.cycles.length >= CHANGE_IMPACT_POLICY.maxCycles) return;
  if (params.path.length > CHANGE_IMPACT_POLICY.maxCycleLength) return;

  const neighbors = params.adjacency.get(params.current) ?? [];
  for (const next of neighbors) {
    if (next === params.start && params.path.length >= 2) {
      const cycle = [...params.path, params.start];
      if (!cycleTouchesSeed(cycle, params.seedFiles)) continue;
      const key = canonicalizeCycle(cycle);
      if (params.seenCycleKeys.has(key)) continue;
      params.seenCycleKeys.add(key);
      params.cycles.push(cycle);
      if (params.cycles.length >= CHANGE_IMPACT_POLICY.maxCycles) return;
      continue;
    }
    if (params.pathSet.has(next)) continue;
    params.path.push(next);
    params.pathSet.add(next);
    dfsCycles({ ...params, current: next });
    params.path.pop();
    params.pathSet.delete(next);
    if (params.cycles.length >= CHANGE_IMPACT_POLICY.maxCycles) return;
  }
}

function buildFileAdjacency(params: {
  graph: RepoGraph;
  edgeTypes: readonly ChangeImpactEdgeType[];
  nodeById: ReadonlyMap<string, RepoGraphNode>;
  fileByFileId: ReadonlyMap<string, RepoGraphFileNode>;
}): Map<string, string[]> {
  const edgeTypes = new Set(params.edgeTypes);
  const adjacency = new Map<string, Set<string>>();

  for (const edge of params.graph.edges) {
    if (
      !isChangeImpactEdgeType(edge.type) ||
      !edgeTypes.has(edge.type) ||
      edge.type === "depends_on" ||
      edge.type === "development_depends_on" ||
      edge.type === "workspace_member"
    ) {
      continue;
    }
    const from = filePathForNode(
      edge.fromNodeId,
      params.nodeById,
      params.fileByFileId,
    );
    const to = filePathForNode(
      edge.toNodeId,
      params.nodeById,
      params.fileByFileId,
    );
    if (!from || !to || from === to) continue;
    const set = adjacency.get(from) ?? new Set<string>();
    set.add(to);
    adjacency.set(from, set);
  }

  const result = new Map<string, string[]>();
  for (const [from, targets] of adjacency) {
    result.set(from, [...targets].sort((a, b) => a.localeCompare(b)));
  }
  return result;
}

function filePathForNode(
  nodeId: string,
  nodeById: ReadonlyMap<string, RepoGraphNode>,
  fileByFileId: ReadonlyMap<string, RepoGraphFileNode>,
): string | undefined {
  const node = nodeById.get(nodeId);
  if (!node || node.kind === "project") return undefined;
  if (node.kind === "file") return node.relativePath;
  return fileByFileId.get(node.fileId)?.relativePath;
}

function cycleTouchesSeed(
  cycle: readonly string[],
  seedFiles: ReadonlySet<string>,
): boolean {
  return cycle.some((path) => seedFiles.has(path));
}

function canonicalizeCycle(cycle: readonly string[]): string {
  // Drop closing duplicate for rotation, then pick lexicographically smallest rotation.
  const body = cycle.slice(0, -1);
  if (body.length === 0) return "";
  let best = body.join("\u0000");
  for (let offset = 1; offset < body.length; offset += 1) {
    const rotated = [...body.slice(offset), ...body.slice(0, offset)].join(
      "\u0000",
    );
    if (rotated.localeCompare(best) < 0) best = rotated;
  }
  return best;
}
