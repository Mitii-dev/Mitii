import { draftClarifyFromDiscovery } from "../../adapters/llm/draftClarifyFromDiscovery";
import { prepareDraftInput } from "../../helpers/prepareDraftInput";
import type { PlanningLlmPort } from "../../ports/PlanningLlmPort";
import type { PlanFlowState } from "../types";

export async function draftClarifyStep(params: {
  state: PlanFlowState;
  llm?: PlanningLlmPort;
}): Promise<
  Pick<PlanFlowState, "clarifyDraft" | "draftWarnings" | "draftReasonCodes">
> {
  const { state, llm } = params;
  const draftWarnings = [...state.draftWarnings];
  const draftReasonCodes = [...state.draftReasonCodes];

  if (state.strategyDecision.strategy !== "clarify" || !state.needsScopeFork) {
    return {
      clarifyDraft: state.clarifyDraft,
      draftWarnings,
      draftReasonCodes,
    };
  }

  const clarifyInput = prepareDraftInput(state.parsed, state.strategyDecision);
  const clarified = await draftClarifyFromDiscovery({
    input: state.parsed,
    discoveryBrief: clarifyInput.discoveryBrief,
    llm,
  });

  if (clarified.ok && clarified.source === "model") {
    draftReasonCodes.push("plan_clarify_drafted");
  } else {
    draftReasonCodes.push("plan_clarify_draft_fallback");
    if (!clarified.ok) {
      draftWarnings.push(clarified.warning);
    }
  }

  return {
    clarifyDraft: clarified.draft,
    draftWarnings,
    draftReasonCodes,
  };
}
