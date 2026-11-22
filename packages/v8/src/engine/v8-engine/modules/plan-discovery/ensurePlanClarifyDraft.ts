/**
 * Guarantee a findings + A/B/C draft when strategy is clarify, or when
 * Agent campaign phase-lock needs chips after a concrete plan.
 */

import {
  buildFallbackClarifyDraft,
  type DiscoveryBrief,
  type PlanClarifyDraft,
  type PlanningParsedInput,
  type PlanStrategyDecision,
} from "../../../../modules/planning";

export function ensurePlanClarifyDraft(params: {
  strategy: PlanStrategyDecision | undefined;
  clarifyDraft: PlanClarifyDraft | undefined;
  planningInput: PlanningParsedInput;
  discoveryBrief?: DiscoveryBrief;
  /** Synthesize even when strategy is not clarify (campaign phase lock). */
  forceForCampaignPhaseLock?: boolean;
}): PlanClarifyDraft | undefined {
  if (params.clarifyDraft) {
    return params.clarifyDraft;
  }
  const needsDraft =
    params.strategy?.strategy === "clarify" ||
    params.forceForCampaignPhaseLock === true;
  if (!needsDraft) {
    return undefined;
  }
  return buildFallbackClarifyDraft(
    params.planningInput,
    params.discoveryBrief ?? params.planningInput.discoveryBrief,
  );
}
