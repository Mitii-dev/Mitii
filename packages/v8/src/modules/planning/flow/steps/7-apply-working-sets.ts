import { applyPlanWorkingSets } from "../../helpers/ApplyPlanWorkingSets";
import type { PlanFlowState } from "../types";

export function applyWorkingSetsStep(
  state: PlanFlowState,
): Pick<PlanFlowState, "drafted" | "draftReasonCodes"> {
  const annotated = applyPlanWorkingSets({
    plan: state.drafted,
    input: state.parsed,
    strategy: state.strategyDecision,
  });
  return {
    drafted: annotated.plan,
    draftReasonCodes: [...state.draftReasonCodes, ...annotated.reasonCodes],
  };
}
