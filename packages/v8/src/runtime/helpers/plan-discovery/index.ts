export { buildReadonlyDiscoveryGrant, DISCOVERY_TOOLS } from "./BuildReadonlyDiscoveryGrant";
export { shouldRunDiscoveryPass } from "./ShouldRunDiscoveryPass";
export type { ShouldRunDiscoveryPassInput } from "./ShouldRunDiscoveryPass";
export {
  enforceDiscoveryQualityFloor,
  countProductiveReads,
  isProductiveDiscoveryPath,
} from "./EnforceDiscoveryQualityFloor";
export type {
  EnforceDiscoveryQualityFloorInput,
  EnforceDiscoveryQualityFloorResult,
} from "./EnforceDiscoveryQualityFloor";
export { runDiscoveryPass } from "./RunDiscoveryPass";
export type {
  RunDiscoveryPassInput,
  RunDiscoveryPassResult,
} from "./RunDiscoveryPass";
export {
  pickRootPeekPaths,
  peekDiscoveryFromWorkspaceRoot,
  discoveryQueryGlobHints,
} from "./DiscoveryRootPeeks";
export type { DiscoveryRootPeekResult } from "./DiscoveryRootPeeks";

export {
  requiresPlanDiscoveryQualityFloor,
  isProductiveDiscoveryReadPath,
  countProductiveDiscoveryReads,
  isPlanDiscoveryEvidenceSufficient,
  isThoroughPlanDiscoveryEvidenceSufficient,
  clarifyAfterInsufficientPlanDiscovery,
  shouldPreferDiscoverySymbolEvidence,
  shouldRequireDiscoverySymbolEvidence,
  usesThoroughPlanDiscoveryEvidence,
  shouldClarifyAfterPlanDiscovery,
  resolvePlanDiscoveryMinSearches,
} from "./PlanDiscoveryQuality";
export type {
  PlanningDepthForQuality,
  PlanningTaskSizeForQuality,
  PlanDiscoverySufficiencyOptions,
} from "./PlanDiscoveryQuality";

export { ensurePlanClarifyDraft } from "./EnsurePlanClarifyDraft";
export { formatPlanAnswerWithNextPhase } from "./FormatPlanAnswerWithNextPhase";
export {
  applyPlanScopePhaseBounds,
  boundImpactSeedsForPlanScope,
} from "./ApplyPlanScopePhaseBounds";
export type {
  PlanScopeChoiceParams,
  PlanScopePhaseBounds,
} from "./ApplyPlanScopePhaseBounds";

export {
  applyPlanModeDiscoveryContract,
  isAgentWidePlanningScope,
} from "./PlanDiscoveryContract";
export type {
  PlanningDepthForContract,
  PlanningTaskSizeForContract,
} from "./PlanDiscoveryContract";
export { isPlanningFollowUp } from "./IsPlanningFollowUp";
export {
  normalizePlanningPath,
  isSafeRelativePlanningPath,
  uniqueStrings,
} from "./PlanningPathUtils";
export {
  isProsePathToken,
  resolveDiscoverySeedPaths,
  DISCOVERY_SEED_DROP_REASONS,
} from "./DiscoverySeedPaths";
export type {
  DiscoverySeedDropReason,
  DroppedSeedPath,
  RewrittenSeedPath,
  DiscoverySeedPathResolution,
} from "./DiscoverySeedPaths";
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
