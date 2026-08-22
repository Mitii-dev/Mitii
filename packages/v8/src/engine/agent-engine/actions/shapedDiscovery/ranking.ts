import {
  isSafeRelativePlanningPath,
  normalizePlanningPath,
  uniqueStrings,
} from "../planningContext";

import type { ShapedDiscoveryProfile } from "./types";

const DEFAULT_MIN_SEED_SCORE = 40;
const DEFAULT_MAX_SEEDS = 4;

export function rankPathsForShapedDiscovery(
  profile: ShapedDiscoveryProfile,
  paths: readonly string[],
): string[] {
  return uniqueStrings(paths.map(normalizePlanningPath))
    .filter((path) => isSafeRelativePlanningPath(path) && path.includes("."))
    .sort((left, right) => {
      const diff = profile.scorePath(right) - profile.scorePath(left);
      return diff !== 0 ? diff : left.localeCompare(right);
    });
}

export function selectShapedDiscoverySeeds(
  profile: ShapedDiscoveryProfile,
  globHits: readonly string[],
  existing: readonly string[],
): string[] {
  const minScore = profile.minSeedScore ?? DEFAULT_MIN_SEED_SCORE;
  const maxSeeds = profile.maxSeeds ?? DEFAULT_MAX_SEEDS;
  return rankPathsForShapedDiscovery(profile, [...globHits, ...existing])
    .filter((path) => profile.scorePath(path) >= minScore)
    .slice(0, maxSeeds);
}
