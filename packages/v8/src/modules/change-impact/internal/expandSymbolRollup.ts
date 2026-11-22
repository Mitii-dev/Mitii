import type { RepoGraphNode, RepoGraphSymbolNode } from "../../repository-state";
import type { ResolvedSeedNode } from "./impactTypes";

/**
 * Expand resolved symbol seeds with parent types and nested methods using
 * published `parentSymbolId` / reverse parent links. Does not invent edges.
 */
export function expandSymbolRollup(params: {
  seeds: readonly ResolvedSeedNode[];
  nodeById: ReadonlyMap<string, RepoGraphNode>;
}): { seeds: ResolvedSeedNode[]; expanded: boolean } {
  const byNodeId = new Map<string, ResolvedSeedNode>();
  for (const seed of params.seeds) {
    byNodeId.set(seed.node.id, seed);
  }

  const childrenByParent = indexChildrenByParent(params.nodeById);
  let expanded = false;

  for (const seed of params.seeds) {
    if (seed.node.kind !== "symbol") continue;
    const symbol = seed.node;

    if (symbol.parentSymbolId) {
      const parent = params.nodeById.get(symbol.parentSymbolId);
      if (parent && parent.kind === "symbol" && !byNodeId.has(parent.id)) {
        byNodeId.set(parent.id, {
          node: parent,
          file: seed.file,
        });
        expanded = true;
      }
    }

    const children = childrenByParent.get(symbol.id) ?? [];
    for (const child of children) {
      if (byNodeId.has(child.id)) continue;
      byNodeId.set(child.id, {
        node: child,
        file: seed.file,
      });
      expanded = true;
    }
  }

  return {
    seeds: [...byNodeId.values()],
    expanded,
  };
}

function indexChildrenByParent(
  nodeById: ReadonlyMap<string, RepoGraphNode>,
): Map<string, RepoGraphSymbolNode[]> {
  const children = new Map<string, RepoGraphSymbolNode[]>();
  for (const node of nodeById.values()) {
    if (node.kind !== "symbol" || !node.parentSymbolId) continue;
    const list = children.get(node.parentSymbolId) ?? [];
    list.push(node);
    children.set(node.parentSymbolId, list);
  }
  return children;
}
