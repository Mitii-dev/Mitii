import type { GateVerdict } from "../kinds";
import type { GateContext } from "../types";

export function requireContinueOnProvider(
  ctx: GateContext,
): GateVerdict | undefined {
  if (!ctx.providerUnavailable) return undefined;
  return {
    action: "suspend",
    kind: "continue_required",
    payload: { continueReason: "provider_unavailable" },
    reasonCodes: ["gate_continue_provider_unavailable"],
  };
}
