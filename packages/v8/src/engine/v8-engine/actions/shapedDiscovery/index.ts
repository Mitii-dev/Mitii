/**
 * Shim — owner is runtime/helpers/shaped-discovery.
 */
export type { ShapedDiscoveryProfile } from "../../../../runtime/helpers/shaped-discovery";
export type {
  CreateShapedDiscoveryProfileInput,
  PathScoreRule,
} from "../../../../runtime/helpers/shaped-discovery";
export {
  createPathScorer,
  createShapedDiscoveryProfile,
  normalizeShapedQuery,
  scoreCommonDiscoveryNoise,
  extractGlobPathsFromToolOutput,
  extractSearchPathsFromToolOutput,
  hasExplicitFilePathTargets,
  isExplicitFilePathTarget,
  rankPathsForShapedDiscovery,
  selectShapedDiscoverySeeds,
  apiBackendDiscoveryProfile,
  authDiscoveryProfile,
  browserTestRunnerDiscoveryProfile,
  buildConfigDiscoveryProfile,
  ciCdDiscoveryProfile,
  databaseDiscoveryProfile,
  frontendComponentDiscoveryProfile,
  monorepoDiscoveryProfile,
  securityDiscoveryProfile,
  testingDiscoveryProfile,
  matchesBrowserTestRunnerQuery,
  SHAPED_DISCOVERY_PROFILES,
  resolveShapedDiscoveryProfile,
  cappedGlobPatterns,
  cappedSearchQueries,
  collectShapedDiscoveryHits,
  buildForceExplorationSearchQueries,
  collectForceExplorationFallbackHits,
} from "../../../../runtime/helpers/shaped-discovery";
