import type { GateVerdict } from "../kinds";
import type { GateContext } from "../types";

export function requireExternalSideEffectApproval(
  ctx: GateContext,
): GateVerdict | undefined {
  if (!ctx.enableExtendedGates || !ctx.needsExternalSideEffectApproval) {
    return undefined;
  }
  return {
    action: "suspend",
    kind: "external_side_effect_required",
    payload: {},
    reasonCodes: ["gate_external_side_effect_required"],
  };
}
