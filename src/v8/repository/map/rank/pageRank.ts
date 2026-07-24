import { REPO_MAP_DEFAULTS } from "../constants";

import type { PageRankEdge, PageRankOptions } from "../types";

export function computePageRank(
  nodes: readonly string[],
  edges: readonly PageRankEdge[],
  options: PageRankOptions = {},
): Map<string, number> {
  if (nodes.length === 0) {
    return new Map();
  }

  const damping = options.damping ?? REPO_MAP_DEFAULTS.PAGE_RANK_DAMPING;

  const iterations =
    options.iterations ?? REPO_MAP_DEFAULTS.PAGE_RANK_ITERATIONS;

  validateDamping(damping);
  validateIterations(iterations);

  const uniqueNodes = [...new Set(nodes)];

  const nodeSet = new Set(uniqueNodes);

  const scores = new Map<string, number>();

  const outgoing = new Map<
    string,
    Array<{
      to: string;
      weight: number;
    }>
  >();

  const personalization = normalizePersonalization(
    uniqueNodes,
    options.personalization,
  );

  for (const node of uniqueNodes) {
    scores.set(node, 1 / uniqueNodes.length);

    outgoing.set(node, []);
  }

  const aggregatedEdges = aggregateEdges(edges, nodeSet);

  for (const edge of aggregatedEdges) {
    outgoing.get(edge.from)?.push({
      to: edge.to,
      weight: edge.weight,
    });
  }

  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const next = new Map<string, number>();

    for (const node of uniqueNodes) {
      next.set(node, (1 - damping) * (personalization.get(node) ?? 0));
    }

    for (const node of uniqueNodes) {
      const links = outgoing.get(node) ?? [];

      const nodeScore = scores.get(node) ?? 0;

      if (links.length === 0) {
        const danglingShare = nodeScore * damping;

        for (const target of uniqueNodes) {
          next.set(
            target,
            (next.get(target) ?? 0) +
              danglingShare * (personalization.get(target) ?? 0),
          );
        }

        continue;
      }

      const totalWeight = links.reduce((total, link) => total + link.weight, 0);

      if (totalWeight <= 0) {
        continue;
      }

      const weightedShare = (nodeScore * damping) / totalWeight;

      for (const link of links) {
        next.set(
          link.to,
          (next.get(link.to) ?? 0) + weightedShare * link.weight,
        );
      }
    }

    for (const node of uniqueNodes) {
      scores.set(node, next.get(node) ?? 0);
    }
  }

  return scores;
}

function aggregateEdges(
  edges: readonly PageRankEdge[],
  nodeSet: ReadonlySet<string>,
): Array<{
  from: string;
  to: string;
  weight: number;
}> {
  const weights = new Map<string, number>();

  for (const edge of edges) {
    if (
      !nodeSet.has(edge.from) ||
      !nodeSet.has(edge.to) ||
      edge.from === edge.to
    ) {
      continue;
    }

    const weight = edge.weight ?? 1;

    if (!Number.isFinite(weight) || weight <= 0) {
      continue;
    }

    const key = `${edge.from}\u0000${edge.to}`;

    weights.set(key, (weights.get(key) ?? 0) + weight);
  }

  return [...weights.entries()]
    .map(([key, weight]) => {
      const separator = key.indexOf("\u0000");

      return {
        from: key.slice(0, separator),
        to: key.slice(separator + 1),
        weight,
      };
    })
    .sort((left, right) => {
      const fromComparison = left.from.localeCompare(right.from);

      if (fromComparison !== 0) {
        return fromComparison;
      }

      return left.to.localeCompare(right.to);
    });
}

function normalizePersonalization(
  nodes: readonly string[],
  personalization?: ReadonlyMap<string, number>,
): Map<string, number> {
  const result = new Map<string, number>();

  if (!personalization || personalization.size === 0) {
    const uniform = 1 / nodes.length;

    for (const node of nodes) {
      result.set(node, uniform);
    }

    return result;
  }

  let total = 0;

  for (const node of nodes) {
    const weight = Math.max(0, personalization.get(node) ?? 0);

    result.set(node, weight);
    total += weight;
  }

  if (total <= 0) {
    const uniform = 1 / nodes.length;

    for (const node of nodes) {
      result.set(node, uniform);
    }

    return result;
  }

  for (const node of nodes) {
    result.set(node, (result.get(node) ?? 0) / total);
  }

  return result;
}

function validateDamping(damping: number): void {
  if (!Number.isFinite(damping) || damping < 0 || damping > 1) {
    throw new RangeError("PageRank damping must be between 0 and 1.");
  }
}

function validateIterations(iterations: number): void {
  if (!Number.isSafeInteger(iterations) || iterations < 0) {
    throw new RangeError(
      "PageRank iterations must be a non-negative safe integer.",
    );
  }
}
