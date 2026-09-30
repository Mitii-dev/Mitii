import { normalizePlanningPath } from "../planningContext";

/** Shared deprioritization for paths that rarely hold the primary edit surface. */
export function scoreCommonDiscoveryNoise(path: string): number {
  const normalized = normalizePlanningPath(path).toLowerCase();
  let score = 0;
  if (/readme\.md$/i.test(normalized)) {
    score -= 30;
  }
  if (/\.gitignore$/i.test(normalized)) {
    score -= 40;
  }
  if (/\/pages?\//i.test(normalized) && !/config/i.test(normalized)) {
    score -= 20;
  }
  if (/package\.json$/i.test(normalized)) {
    score -= 25;
  }
  return score;
}
