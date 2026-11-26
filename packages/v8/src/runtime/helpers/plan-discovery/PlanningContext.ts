/** Planning context helpers — query + path hints + path utils re-exports. */
export {
  isSafeRelativePlanningPath,
  normalizePlanningPath,
  uniqueStrings,
} from "./PlanningPathUtils";
export { isPlanningFollowUp } from "./IsPlanningFollowUp";
export {
  inferDiscoveryTargetKind,
  buildScopedRepoMapForPlanning,
  toPlanningBuildEvidence,
  inferLanguageFromPaths,
  buildPlanningQuery,
  looksLikeMultiItemPlanGuidance,
} from "./PlanningQuery";
export type { PlanningTaskSize } from "./PlanningPathHints";
export {
  resolveFollowUpPlanningTaskSize,
  extractPriorPathHints,
  resolvePriorPathHintBudget,
  mergeContextPathsWithPriorHints,
  collectPreferredPlanningPaths,
  collectTrustedSeedPaths,
  extractFileLikePaths,
} from "./PlanningPathHints";
