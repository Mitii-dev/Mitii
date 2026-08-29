import { normalizePlanningPath } from "../planningContext";

import { scoreCommonDiscoveryNoise } from "./pathNoise";
import type { ShapedDiscoveryProfile } from "./types";

export type PathScoreRule = { pattern: RegExp; score: number };

export function normalizeShapedQuery(query: string): string {
  return query.trim().toLowerCase().replace(/\s+/g, " ");
}

export function createPathScorer(
  pathScoreRules: readonly PathScoreRule[],
  pathDemotionRules: readonly PathScoreRule[] = [],
): (path: string) => number {
  return (path: string) => {
    const normalized = normalizePlanningPath(path).toLowerCase();
    let score = scoreCommonDiscoveryNoise(path);
    for (const rule of pathScoreRules) {
      if (rule.pattern.test(normalized)) {
        score += rule.score;
      }
    }
    for (const rule of pathDemotionRules) {
      if (rule.pattern.test(normalized)) {
        score += rule.score;
      }
    }
    return score;
  };
}

const DEFAULT_SPEC_DEMOTION: PathScoreRule[] = [
  { pattern: /\.(?:test|spec)\.(?:ts|js|jsx|tsx|mjs|cjs|yml|yaml)$/i, score: -30 },
];

const DEFAULT_DOCS_DEMOTION: PathScoreRule[] = [
  { pattern: /(?:^|\/)(?:docs?|documentation)\//i, score: -60 },
];

export type CreateShapedDiscoveryProfileInput = {
  id: string;
  priority: number;
  strongPatterns: RegExp[];
  weakPatterns?: RegExp[];
  rejectQuery?: (normalizedQuery: string) => boolean;
  matchesQuery?: (query: string) => boolean;
  pathScoreRules: PathScoreRule[];
  pathDemotionRules?: PathScoreRule[];
  includeDefaultSpecDemotion?: boolean;
  includeDefaultDocsDemotion?: boolean;
  globPatterns: readonly string[];
  searchQueries: readonly string[];
  maxGlobPatterns?: number;
  maxSearchQueries?: number;
  minSeedScore?: number;
  maxSeeds?: number;
  preferredPathsLabel?: string;
  discoverySystemHint?: string;
};

export function createShapedDiscoveryProfile(
  input: CreateShapedDiscoveryProfileInput,
): ShapedDiscoveryProfile {
  const weakPatterns = input.weakPatterns ?? [];
  const matchesQuery =
    input.matchesQuery ??
    ((query: string) => {
      const q = normalizeShapedQuery(query);
      if (!q) {
        return false;
      }
      if (input.rejectQuery?.(q)) {
        return false;
      }
      if (input.strongPatterns.some((pattern) => pattern.test(q))) {
        return true;
      }
      const weakMatches = weakPatterns.filter((pattern) => pattern.test(q)).length;
      return weakMatches >= 2;
    });

  const demotionRules = [
    ...(input.includeDefaultDocsDemotion !== false ? DEFAULT_DOCS_DEMOTION : []),
    ...(input.pathDemotionRules ?? []),
    ...(input.includeDefaultSpecDemotion !== false ? DEFAULT_SPEC_DEMOTION : []),
  ];

  return {
    id: input.id,
    priority: input.priority,
    matchesQuery,
    globPatterns: input.globPatterns,
    searchQueries: input.searchQueries,
    maxGlobPatterns: input.maxGlobPatterns ?? 3,
    maxSearchQueries: input.maxSearchQueries ?? 1,
    scorePath: createPathScorer(input.pathScoreRules, demotionRules),
    minSeedScore: input.minSeedScore ?? 30,
    maxSeeds: input.maxSeeds ?? 4,
    preferredPathsLabel: input.preferredPathsLabel,
    discoverySystemHint: input.discoverySystemHint,
  };
}
