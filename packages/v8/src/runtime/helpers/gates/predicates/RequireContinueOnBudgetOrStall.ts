import type { GateVerdict } from "../kinds";
import type { GateContext } from "../types";

export function requireContinueOnBudgetOrStall(
  ctx: GateContext,
): GateVerdict | undefined {
  if (ctx.budgetHardWall) {
    return {
      action: "suspend",
      kind: "continue_required",
      payload: { continueReason: "budget_exhausted" },
      reasonCodes: ["gate_continue_budget_exhausted"],
    };
  }
  if (ctx.stalledOrBlocked) {
    return {
      action: "suspend",
      kind: "continue_required",
      payload: { continueReason: "stalled_or_blocked" },
      reasonCodes: ["gate_continue_stalled_or_blocked"],
    };
  }
  if (ctx.incompleteProgress) {
    return {
      action: "suspend",
      kind: "continue_required",
      payload: { continueReason: "incomplete_progress" },
      reasonCodes: ["gate_continue_incomplete_progress"],
    };
  }
  return undefined;
}
