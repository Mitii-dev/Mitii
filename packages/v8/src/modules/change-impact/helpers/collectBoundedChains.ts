import type { ChangeImpactReasonCode } from "../contracts";
import type { RepoGraphEdge } from "../../repository-state";
import type { BoundedWalkNeighbor } from "./walkBoundedDependents";

export interface ImpactChainPath {
  /** Node ids from seed through tip (inclusive). Length >= 2. */
  nodeIds: string[];
  hop: number;
  tipEdge: RepoGraphEdge;
  score: number;
}

/**
 * Goose-style path BFS: enumerates impact chains with per-path cycle
 * detection, capped by `maximumPaths` independently of the node report.
 */
export function collectBoundedChains<TEdge extends RepoGraphEdge>(params: {
  seedNodeIds: readonly string[];
  maximumHops: number;
  maximumPaths: number;
  adjacency: ReadonlyMap<string, readonly BoundedWalkNeighbor<TEdge>[]>;
  nodeExists: (nodeId: string) => boolean;
  score: (edge: TEdge, hop: number, nodeId: string) => number;
}): {
  chains: ImpactChainPath[];
  truncated: boolean;
  reasonCodes: ChangeImpactReasonCode[];
} {
  if (params.maximumPaths <= 0 || params.maximumHops <= 0) {
    return { chains: [], truncated: false, reasonCodes: [] };
  }

  const seedIds = new Set(params.seedNodeIds);
  const queue: Array<{ path: string[]; hop: number; tipEdge: TEdge }> = [];
  const chains: ImpactChainPath[] = [];
  const reasonCodes = new Set<ChangeImpactReasonCode>();
  let truncated = false;

  outer: for (const seedId of params.seedNodeIds) {
    const neighbors = params.adjacency.get(seedId) ?? [];
    for (const neighbor of neighbors) {
      if (seedIds.has(neighbor.nodeId)) continue;
      if (!params.nodeExists(neighbor.nodeId)) continue;
      if (queue.length + chains.length >= params.maximumPaths) {
        truncated = true;
        reasonCodes.add("path_limit_reached");
        break outer;
      }
      queue.push({
        path: [seedId, neighbor.nodeId],
        hop: 1,
        tipEdge: neighbor.edge,
      });
    }
  }

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) break;

    const tip = current.path[current.path.length - 1];
    if (!tip) continue;

    if (current.hop >= params.maximumHops) {
      chains.push(toChain(current, params.score));
      if (chains.length >= params.maximumPaths) {
        truncated = true;
        reasonCodes.add("path_limit_reached");
        break;
      }
      continue;
    }

    const neighbors = params.adjacency.get(tip) ?? [];
    const pathSet = new Set(current.path);
    let extended = false;

    for (const neighbor of neighbors) {
      if (pathSet.has(neighbor.nodeId)) continue; // per-path cycle
      if (seedIds.has(neighbor.nodeId)) continue;
      if (!params.nodeExists(neighbor.nodeId)) continue;

      if (chains.length + queue.length >= params.maximumPaths) {
        truncated = true;
        reasonCodes.add("path_limit_reached");
        break;
      }

      queue.push({
        path: [...current.path, neighbor.nodeId],
        hop: current.hop + 1,
        tipEdge: neighbor.edge,
      });
      extended = true;
    }

    if (!extended) {
      chains.push(toChain(current, params.score));
      if (chains.length >= params.maximumPaths) {
        truncated = true;
        reasonCodes.add("path_limit_reached");
        break;
      }
    }
  }

  // Drain remaining queue tips as incomplete chains when path budget tripped mid-expand.
  while (queue.length > 0 && chains.length < params.maximumPaths) {
    const current = queue.shift();
    if (!current) break;
    chains.push(toChain(current, params.score));
  }
  if (queue.length > 0) {
    truncated = true;
    reasonCodes.add("path_limit_reached");
  }

  chains.sort(
    (left, right) =>
      left.hop - right.hop ||
      right.score - left.score ||
      left.nodeIds.join("\0").localeCompare(right.nodeIds.join("\0")),
  );

  return {
    chains,
    truncated,
    reasonCodes: [...reasonCodes],
  };
}

function toChain<TEdge extends RepoGraphEdge>(
  current: { path: string[]; hop: number; tipEdge: TEdge },
  score: (edge: TEdge, hop: number, nodeId: string) => number,
): ImpactChainPath {
  const tip = current.path[current.path.length - 1] ?? "";
  return {
    nodeIds: current.path,
    hop: current.hop,
    tipEdge: current.tipEdge,
    score: score(current.tipEdge, current.hop, tip),
  };
}

/**
 * Collapse chains that share a prefix into Goose-style grouped lines:
 *   a → b
 *     → c1
 *     → c2
 */
export function collapseChainPrefixes(
  chainLabels: readonly string[][],
): string[] {
  const formatted = chainLabels
    .map((links) => links.filter((link) => link.length > 0))
    .filter((links) => links.length >= 2)
    .sort((left, right) =>
      left.join("\0").localeCompare(right.join("\0")),
    );

  const lines: string[] = [];
  let index = 0;
  while (index < formatted.length) {
    const chain = formatted[index];
    if (!chain) break;
    let groupEnd = index + 1;
    if (chain.length >= 2) {
      const prefix = chain.slice(0, -1);
      while (groupEnd < formatted.length) {
        const next = formatted[groupEnd];
        if (
          next &&
          next.length >= 2 &&
          next.slice(0, -1).join("\0") === prefix.join("\0")
        ) {
          groupEnd += 1;
        } else {
          break;
        }
      }
    }

    if (groupEnd - index > 1) {
      const prefix = chain.slice(0, -1);
      lines.push(prefix.join(" → "));
      for (let i = index; i < groupEnd; i += 1) {
        const entry = formatted[i];
        const tail = entry?.[entry.length - 1];
        if (tail) lines.push(`  → ${tail}`);
      }
    } else {
      lines.push(chain.join(" → "));
    }
    index = groupEnd;
  }
  return lines;
}
