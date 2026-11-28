import type { GateVerdict } from "../kinds";
import type { GateContext } from "../types";

/** after_decide: early clarify when disposition requires it. */
export function requireClarificationAfterDecide(
  ctx: GateContext,
): GateVerdict | undefined {
  if (ctx.runDisposition !== "clarification_required" && ctx.route !== "clarify") {
    return undefined;
  }
  return {
    action: "suspend",
    kind: "clarification_required",
    payload: { clarifyOrigin: "early_decide" },
    reasonCodes: ["gate_clarify_after_decide"],
  };
}
