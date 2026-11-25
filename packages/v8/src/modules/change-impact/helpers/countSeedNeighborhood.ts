import type {
  RepoGraph,
  RepoGraphFileNode,
  RepoGraphNode,
} from "../../repository-state";
import type { ChangeImpactEdgeType } from "./impactTypes";
import { isChangeImpactEdgeType } from "./impactGraphHelpers";

/**
 * Count unique file neighbors of seed nodes in both directions for fragility.
 */
export function countSeedNeighborhood(params: {
  graph: RepoGraph;
  seedNodeIds: readonly string[];
  edgeTypes: readonly ChangeImpactEdgeType[];
  nodeById: ReadonlyMap<string, RepoGraphNode>;
  fileByFileId: ReadonlyMap<string, RepoGraphFileNode>;
}): { inFiles: number; outFiles: number } {
  const edgeTypes = new Set(params.edgeTypes);
  const seedSet = new Set(params.seedNodeIds);
  const inFiles = new Set<string>();
  const outFiles = new Set<string>();

  for (const edge of params.graph.edges) {
    if (
      !isChangeImpactEdgeType(edge.type) ||
      !edgeTypes.has(edge.type) ||
      !params.nodeById.has(edge.fromNodeId) ||
      !params.nodeById.has(edge.toNodeId)
    ) {
      continue;
    }

    if (seedSet.has(edge.toNodeId)) {
      const filePath = filePathForNode(
        edge.fromNodeId,
        params.nodeById,
        params.fileByFileId,
      );
      if (filePath) inFiles.add(filePath);
    }
    if (seedSet.has(edge.fromNodeId)) {
      const filePath = filePathForNode(
        edge.toNodeId,
        params.nodeById,
        params.fileByFileId,
      );
      if (filePath) outFiles.add(filePath);
    }
  }

  return { inFiles: inFiles.size, outFiles: outFiles.size };
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
