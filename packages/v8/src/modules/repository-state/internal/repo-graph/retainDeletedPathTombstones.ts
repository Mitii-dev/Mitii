import type {
  RepoGraph,
  RepoGraphEdge,
  RepoGraphFileNode,
  RepoGraphNode,
} from "./types";

const MAX_TOMBSTONE_NODES = 200;
const MAX_TOMBSTONE_EDGES = 400;

/**
 * Retain deleted file nodes from a prior graph as tombstones, plus edges that
 * still connect to live or tombstone endpoints. Caps keep rebuilds bounded.
 */
export function retainDeletedPathTombstones(params: {
  graph: RepoGraph;
  priorGraph?: RepoGraph;
  presentRelativePaths: ReadonlySet<string>;
}): RepoGraph {
  const prior = params.priorGraph;
  if (!prior) return params.graph;

  const liveIds = new Set(params.graph.nodes.map((node) => node.id));
  const livePaths = new Set(
    params.graph.nodes
      .filter((node): node is RepoGraphFileNode => node.kind === "file")
      .map((node) => normalizePath(node.relativePath)),
  );

  const tombstones: RepoGraphFileNode[] = [];
  for (const node of prior.nodes) {
    if (node.kind !== "file") continue;
    const path = normalizePath(node.relativePath);
    if (livePaths.has(path) || params.presentRelativePaths.has(path)) {
      continue;
    }
    if (liveIds.has(node.id)) continue;
    tombstones.push({
      ...node,
      tombstone: true,
    });
    if (tombstones.length >= MAX_TOMBSTONE_NODES) break;
  }

  if (tombstones.length === 0) {
    return params.graph;
  }

  const mergedNodes: RepoGraphNode[] = [
    ...params.graph.nodes,
    ...tombstones,
  ];
  const nodeIds = new Set(mergedNodes.map((node) => node.id));
  const existingEdgeIds = new Set(params.graph.edges.map((edge) => edge.id));

  const retainedEdges: RepoGraphEdge[] = [];
  for (const edge of prior.edges) {
    if (existingEdgeIds.has(edge.id)) continue;
    if (!nodeIds.has(edge.fromNodeId) || !nodeIds.has(edge.toNodeId)) {
      continue;
    }
    const fromTombstone = tombstones.some((node) => node.id === edge.fromNodeId);
    const toTombstone = tombstones.some((node) => node.id === edge.toNodeId);
    if (!fromTombstone && !toTombstone) continue;
    retainedEdges.push(edge);
    if (retainedEdges.length >= MAX_TOMBSTONE_EDGES) break;
  }

  const edges = [...params.graph.edges, ...retainedEdges];
  const fileNodes = mergedNodes.filter((node) => node.kind === "file").length;

  return {
    ...params.graph,
    nodes: mergedNodes,
    edges,
    statistics: {
      ...params.graph.statistics,
      fileNodes,
      indexedFiles: fileNodes,
      containsEdges: countEdges(edges, "contains"),
      declaresEdges: countEdges(edges, "declares"),
      importEdges: countEdges(edges, "imports"),
      callEdges: countEdges(edges, "calls"),
      referenceEdges: countEdges(edges, "references"),
      heritageEdges:
        countEdges(edges, "extends") + countEdges(edges, "implements"),
      projectRelationshipEdges:
        countEdges(edges, "workspace_member") +
        countEdges(edges, "depends_on") +
        countEdges(edges, "development_depends_on"),
    },
  };
}

function countEdges(
  edges: readonly RepoGraphEdge[],
  type: RepoGraphEdge["type"],
): number {
  return edges.filter((edge) => edge.type === type).length;
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\.\//, "").replace(/^\/+/, "");
}
