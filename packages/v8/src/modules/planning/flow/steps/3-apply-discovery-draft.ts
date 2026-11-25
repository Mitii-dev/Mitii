import { draftPlanFromDiscovery } from "../../adapters/llm/draftPlanFromDiscovery";
import { applyDiscoveredPlanDraft } from "../../helpers/ApplyDiscoveredPlanDraft";
import {
  isThinDiscoveryBriefForDraft,
  requiresNonSkeletonDiscoveryDraft,
} from "../../helpers/discoveryDraftQuality";
import type { PlanningLlmPort } from "../../ports/PlanningLlmPort";
import type { PlanFlowState } from "../types";

export async function applyDiscoveryDraftStep(params: {
  state: PlanFlowState;
  llm?: PlanningLlmPort;
}): Promise<
  Pick<
    PlanFlowState,
    "drafted" | "draftWarnings" | "draftReasonCodes" | "draftedFromDiscovery"
  >
> {
  const { state, llm } = params;
  const draftWarnings = [...state.draftWarnings];
  const draftReasonCodes = [...state.draftReasonCodes];
  let drafted = state.drafted;
  let draftedFromDiscovery = false;

  const requireModelDraft = requiresNonSkeletonDiscoveryDraft({
    input: state.parsed,
    strategy: state.strategyDecision,
  });

  if (
    state.strategyDecision.strategy !== "discover_and_plan" ||
    !state.parsed.discoveryBrief
  ) {
    return { drafted, draftWarnings, draftReasonCodes, draftedFromDiscovery };
  }

  if (isThinDiscoveryBriefForDraft(state.parsed.discoveryBrief)) {
    draftReasonCodes.push("plan_discovery_draft_skipped_thin_brief");
    draftWarnings.push(
      "Discovery evidence was thin; kept the deterministic plan skeleton instead of a model draft.",
    );
  } else if (llm) {
    const discovered = await draftPlanFromDiscovery({
      input: state.parsed,
      discoveryBrief: state.parsed.discoveryBrief,
      llm,
    });
    if (discovered.ok) {
      drafted = applyDiscoveredPlanDraft({
        skeleton: drafted,
        draft: discovered.draft,
        input: state.parsed,
      });
      draftedFromDiscovery = true;
      draftReasonCodes.push("plan_drafted_from_discovery");
    } else {
      draftWarnings.push(discovered.warning);
      draftReasonCodes.push("plan_discovery_draft_failed_fallback");
    }
  } else if (requireModelDraft) {
    draftReasonCodes.push("plan_discovery_draft_required_clarify");
    draftWarnings.push(
      "Plan requires a discovery model draft but no planning LLM is configured; clarifying instead of a hollow skeleton.",
    );
  }

  return { drafted, draftWarnings, draftReasonCodes, draftedFromDiscovery };
}
