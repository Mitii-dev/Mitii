import type { GateVerdict } from "../kinds";
import type { GateContext } from "../types";

/** after_plan: plan mode / route=plan → COMPLETE (host Build later). */
export function completePlanMode(ctx: GateContext): GateVerdict | undefined {
  if (ctx.mode === "plan" || ctx.route === "plan") {
    return {
      action: "complete",
      terminal: "plan_ready_complete",
      payload: {},
      reasonCodes: ["gate_plan_ready_complete"],
    };
  }
  return undefined;
}
