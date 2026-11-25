import { draftPlan } from "../../helpers/DraftPlan";
import { prepareDraftInput } from "../../helpers/prepareDraftInput";
import type { PlanFlowState } from "../types";

export function draftSkeletonStep(
  state: PlanFlowState,
): Pick<PlanFlowState, "drafted"> {
  const draftInput = prepareDraftInput(state.parsed, state.strategyDecision);
  return {
    drafted: draftPlan({
      ...draftInput,
      strategy: state.strategyDecision,
    }),
  };
}
