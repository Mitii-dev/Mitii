import { draftPlan } from "../../helpers/DraftPlan";
import {
  clarifyStrategyAfterFailedDiscoveryDraft,
  isGenericDiscoverySkeletonPlan,
  requiresNonSkeletonDiscoveryDraft,
} from "../../helpers/discoveryDraftQuality";
import { askNeedsPlanScopeFork } from "../../helpers/askNeedsPlanScopeFork";
import { hasResolvedPlanScopeChoice } from "../../helpers/planScopeChoice";
import { prepareDraftInput } from "../../helpers/prepareDraftInput";
import { thinDiscoveryBriefForClarify } from "../../helpers/thinDiscoveryBriefForClarify";
import type { PlanFlowState } from "../types";

/**
 * Medium+/multi-item Plan: never ship the generic discovery skeleton.
 * If the user already picked A/B/C scope, keep drafting — do not re-clarify.
 * Clear single-outcome feature/bugfix asks also keep drafting.
 */
export function enforceDiscoveryQualityStep(
  state: PlanFlowState,
): Pick<
  PlanFlowState,
  | "strategyDecision"
  | "drafted"
  | "draftWarnings"
  | "draftReasonCodes"
  | "needsScopeFork"
> {
  const draftWarnings = [...state.draftWarnings];
  const draftReasonCodes = [...state.draftReasonCodes];
  let strategyDecision = state.strategyDecision;
  let drafted = state.drafted;

  const requireModelDraft = requiresNonSkeletonDiscoveryDraft({
    input: state.parsed,
    strategy: strategyDecision,
  });
  const scopeAlreadyChosen = hasResolvedPlanScopeChoice({
    query: state.parsed.query,
  });
  const needsScopeFork = askNeedsPlanScopeFork({
    clarity: state.parsed.evidence.clarity,
    primaryIntent: state.parsed.evidence.primaryIntent,
    requestedOutcomes: state.parsed.evidence.requestedOutcomes,
    query: state.parsed.query,
  });

  if (
    requireModelDraft &&
    (!state.draftedFromDiscovery || isGenericDiscoverySkeletonPlan(drafted)) &&
    !scopeAlreadyChosen &&
    needsScopeFork
  ) {
    strategyDecision = clarifyStrategyAfterFailedDiscoveryDraft(strategyDecision);
    drafted = draftPlan({
      ...prepareDraftInput(
        {
          ...state.parsed,
          discoveryBrief: thinDiscoveryBriefForClarify(state.parsed.discoveryBrief, [
            "Which concrete files, symbols, and verify commands should each improvement cover?",
          ]),
        },
        strategyDecision,
      ),
      strategy: strategyDecision,
    });
    draftReasonCodes.push("plan_discovery_draft_required_clarify");
    draftWarnings.push(
      "Rejected hollow discovery skeleton for Plan; drafted clarifying open questions instead.",
    );
  } else if (
    requireModelDraft &&
    (!state.draftedFromDiscovery || isGenericDiscoverySkeletonPlan(drafted)) &&
    !scopeAlreadyChosen &&
    !needsScopeFork
  ) {
    draftWarnings.push(
      "Kept discovery-grounded plan for a clear single-outcome ask instead of forcing harness A/B/C clarify.",
    );
  }

  return {
    strategyDecision,
    drafted,
    draftWarnings,
    draftReasonCodes,
    needsScopeFork,
  };
}
