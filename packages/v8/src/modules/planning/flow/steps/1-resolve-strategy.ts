import { resolvePlanStrategy } from "../../helpers/ResolvePlanStrategy";
import type { PlanFlowState } from "../types";

export function resolveStrategyStep(
  state: PlanFlowState,
): Pick<
  PlanFlowState,
  "strategyDecision" | "strategyWarnings" | "strategyReasonCodes"
> {
  const strategy = resolvePlanStrategy({ input: state.parsed });
  return {
    strategyDecision: strategy.decision,
    strategyWarnings: [...strategy.warnings],
    strategyReasonCodes: [...strategy.reasonCodes],
  };
}
