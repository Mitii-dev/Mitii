/**
 * Engine plan-discovery surface — thin re-exports.
 * Owners: runtime/helpers/plan-discovery + modules/window-budget + runtime gates.
 * Remaining engine-local: planDiscoveryContract (shaped-discovery deps).
 */

export * from "./planDiscoveryContract";
export * from "./planDiscoveryQuality";
export * from "./discoveryBudgets";
export {
  applyPlanScopePhaseBounds,
  boundImpactSeedsForPlanScope,
} from "./applyPlanScopePhaseBounds";
export type {
  PlanScopeChoiceParams,
  PlanScopePhaseBounds,
} from "./applyPlanScopePhaseBounds";
export { formatPlanAnswerWithNextPhase } from "./formatPlanAnswerWithNextPhase";
export {
  hasResolvedPlanScopeChoice,
  resolvePlanScopeId,
  collectCompletedPlanScopeIds,
  boundPreferredPathsForPlanScope,
  planScopeDiscoveryHint,
  remainingPlanScopeIds,
  formatNextPlanPhaseOffer,
  appendNextPlanPhaseOffer,
} from "../../../../modules/planning";
export {
  shouldSuspendForPlanScopeFork,
  shouldForceCampaignPhaseLock,
} from "./shouldSuspendForPlanScopeFork";
export { ensurePlanClarifyDraft } from "./ensurePlanClarifyDraft";
