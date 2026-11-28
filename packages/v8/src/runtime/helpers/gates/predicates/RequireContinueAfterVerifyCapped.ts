import type { GateVerdict } from "../kinds";
import type { GateContext } from "../types";

export function requireContinueAfterVerifyCapped(
  ctx: GateContext,
): GateVerdict | undefined {
  if (!ctx.verificationRepairCapped) return undefined;
  return {
    action: "suspend",
    kind: "continue_required",
    payload: { continueReason: "verification_repair_capped" },
    reasonCodes: ["gate_continue_verification_repair_capped"],
  };
}
