/**
 * Shim — owner is runtime/helpers/plan-discovery (PlanningContext / Query / PathHints).
 */
export {
  buildPlanningQuery,
  buildScopedRepoMapForPlanning,
  collectPreferredPlanningPaths,
  collectTrustedSeedPaths,
  extractPriorPathHints,
  inferDiscoveryTargetKind,
  inferLanguageFromPaths,
  isPlanningFollowUp,
  isSafeRelativePlanningPath,
  looksLikeMultiItemPlanGuidance,
  mergeContextPathsWithPriorHints,
  normalizePlanningPath,
  resolveFollowUpPlanningTaskSize,
  resolvePriorPathHintBudget,
  toPlanningBuildEvidence,
  uniqueStrings,
  extractFileLikePaths,
} from "../../../runtime/helpers/plan-discovery";
export type { PlanningTaskSize } from "../../../runtime/helpers/plan-discovery";
