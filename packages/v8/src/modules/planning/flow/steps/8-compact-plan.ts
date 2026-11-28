import { compactPlan } from "../../helpers/CompactPlan";
import type { PlanFlowState } from "../types";

export function compactPlanStep(
  state: PlanFlowState,
): Pick<PlanFlowState, "drafted" | "draftReasonCodes" | "status" | "usedTokens"> {
  const compacted = compactPlan({
    plan: state.drafted,
    budgetTokens: state.parsed.budgetTokens,
  });
  return {
    drafted: compacted.plan,
    draftReasonCodes: [...state.draftReasonCodes, ...compacted.reasonCodes],
    status: compacted.compacted ? "compacted" : "validated",
    usedTokens: compacted.usedTokens,
  };
}
