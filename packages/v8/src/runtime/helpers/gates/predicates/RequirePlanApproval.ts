import type { GateVerdict } from "../kinds";
import type { GateContext } from "../types";

/** after_plan: agent execute + visible + planGate required. */
export function requirePlanApproval(ctx: GateContext): GateVerdict | undefined {
  if (ctx.mode !== "agent") return undefined;
  if (ctx.route !== "execute") return undefined;
  if (ctx.planningDepth !== "visible") return undefined;
  if (ctx.planGate !== "required_before_execute") return undefined;

  return {
    action: "suspend",
    kind: "plan_approval_required",
    payload: {},
    reasonCodes: ["gate_plan_approval_required"],
  };
}
