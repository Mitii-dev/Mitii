import { validatePlan } from "../../helpers/ValidatePlan";
import type { PlanFlowState } from "../types";

export function validatePlanStep(
  state: PlanFlowState,
): Pick<
  PlanFlowState,
  "drafted" | "draftWarnings" | "draftReasonCodes" | "blocked" | "status"
> {
  const validated = validatePlan({
    plan: state.drafted,
    input: state.parsed,
    strategy: state.strategyDecision,
  });

  if (!validated.ok) {
    return {
      drafted: state.drafted,
      draftWarnings: [...state.draftWarnings, ...validated.warnings],
      draftReasonCodes: [...state.draftReasonCodes, ...validated.reasonCodes],
      blocked: true,
      status: "blocked",
    };
  }

  return {
    drafted: validated.plan,
    draftWarnings: [...state.draftWarnings, ...validated.warnings],
    draftReasonCodes: [...state.draftReasonCodes, ...validated.reasonCodes],
    blocked: false,
    status: "validated",
  };
}
