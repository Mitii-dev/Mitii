export type { ShapedDiscoveryProfile } from "./types";
export type { CreateShapedDiscoveryProfileInput, PathScoreRule } from "./factory";
export {
  createPathScorer,
  createShapedDiscoveryProfile,
  normalizeShapedQuery,
} from "./factory";
export { scoreCommonDiscoveryNoise } from "./pathNoise";
export {
  extractGlobPathsFromToolOutput,
  extractSearchPathsFromToolOutput,
} from "./toolOutput";
export {
  rankPathsForShapedDiscovery,
  selectShapedDiscoverySeeds,
} from "./ranking";
export { apiBackendDiscoveryProfile } from "./profiles/apiBackend";
export { authDiscoveryProfile } from "./profiles/auth";
export { browserTestRunnerDiscoveryProfile } from "./profiles/browserTestRunner";
export { buildConfigDiscoveryProfile } from "./profiles/buildConfig";
export { ciCdDiscoveryProfile } from "./profiles/ciCd";
export { databaseDiscoveryProfile } from "./profiles/database";
export { frontendComponentDiscoveryProfile } from "./profiles/frontendComponent";
export { matchesBrowserTestRunnerQuery } from "./profiles/browserTestRunner";
export {
  SHAPED_DISCOVERY_PROFILES,
  resolveShapedDiscoveryProfile,
} from "./registry";
export {
  cappedGlobPatterns,
  cappedSearchQueries,
  collectShapedDiscoveryHits,
} from "./preflight";
