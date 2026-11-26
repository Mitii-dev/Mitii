/**
 * Shim — owner is runtime/helpers/plan-discovery (S3A evacuate).
 */
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
} from "../../../../runtime/helpers/plan-discovery/PlanDiscoveryQuality";
export type {
  PlanningDepthForQuality,
  PlanningTaskSizeForQuality,
  PlanDiscoverySufficiencyOptions,
} from "../../../../runtime/helpers/plan-discovery/PlanDiscoveryQuality";
