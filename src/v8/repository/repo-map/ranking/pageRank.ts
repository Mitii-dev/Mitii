import {
  REPO_MAP_DEFAULTS,
} from "../constants";

import type {
  PageRankEdge,
  PageRankOptions,
} from "../types";

export const computePageRank = (
  nodes: readonly string[],
  edges: readonly PageRankEdge[],
  options: PageRankOptions = {},
): Map<string, number> => {
  const uniqueNodes =
    [...new Set(nodes)].sort();

  if (uniqueNodes.length === 0) {
    return new Map();
  }

  const nodeSet =
    new Set(uniqueNodes);

  const damping =
    options.damping ??
    REPO_MAP_DEFAULTS.PAGE_RANK_DAMPING;

  const iterations =
    options.iterations ??
    REPO_MAP_DEFAULTS
      .PAGE_RANK_ITERATIONS;

  const outgoing =
    new Map<
      string,
      Map<string, number>
    >();

  for (const node of uniqueNodes) {
    outgoing.set(
      node,
      new Map(),
    );
  }

  for (const edge of edges) {
    if (
      !nodeSet.has(edge.from) ||
      !nodeSet.has(edge.to) ||
      edge.from === edge.to
    ) {
      continue;
    }

    const targets =
      outgoing.get(edge.from);

    if (!targets) {
      continue;
    }

    targets.set(
      edge.to,
      (targets.get(edge.to) ?? 0) +
        Math.max(
          0,
          edge.weight ?? 1,
        ),
    );
  }

  const personalization =
    normalizePersonalization(
      uniqueNodes,
      options.personalization,
    );

  let scores =
    new Map(
      uniqueNodes.map((node) => [
        node,
        1 / uniqueNodes.length,
      ]),
    );

  for (
    let iteration = 0;
    iteration < iterations;
    iteration += 1
  ) {
    const next =
      new Map(
        uniqueNodes.map((node) => [
          node,
          (1 - damping) *
            (personalization.get(
              node,
            ) ?? 0),
        ]),
      );

    let danglingScore = 0;

    for (const node of uniqueNodes) {
      const sourceScore =
        scores.get(node) ?? 0;

      const targets =
        outgoing.get(node) ??
        new Map();

      const totalWeight =
        [...targets.values()].reduce(
          (sum, weight) =>
            sum + weight,
          0,
        );

      if (totalWeight <= 0) {
        danglingScore += sourceScore;
        continue;
      }

      for (
        const [
          target,
          weight,
        ] of targets
      ) {
        next.set(
          target,
          (next.get(target) ?? 0) +
            damping *
              sourceScore *
              (weight /
                totalWeight),
        );
      }
    }

    if (danglingScore > 0) {
      for (const node of uniqueNodes) {
        next.set(
          node,
          (next.get(node) ?? 0) +
            damping *
              danglingScore *
              (personalization.get(
                node,
              ) ?? 0),
        );
      }
    }

    scores = next;
  }

  return scores;
};

const normalizePersonalization = (
  nodes: readonly string[],
  values?: ReadonlyMap<string, number>,
): Map<string, number> => {
  const result =
    new Map<string, number>();

  let total = 0;

  for (const node of nodes) {
    const value =
      Math.max(
        0,
        values?.get(node) ?? 1,
      );

    result.set(node, value);
    total += value;
  }

  if (total <= 0) {
    const equal =
      1 / nodes.length;

    for (const node of nodes) {
      result.set(node, equal);
    }

    return result;
  }

  for (const node of nodes) {
    result.set(
      node,
      (result.get(node) ?? 0) /
        total,
    );
  }

  return result;
};

