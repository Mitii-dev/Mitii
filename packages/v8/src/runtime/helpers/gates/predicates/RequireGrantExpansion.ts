import type { GateVerdict } from "../kinds";
import type { GateContext } from "../types";

export function requireGrantExpansion(ctx: GateContext): GateVerdict | undefined {
  if (!ctx.needsGrantExpansion) return undefined;
  return {
    action: "suspend",
    kind: "grant_expansion_required",
    payload: {},
    reasonCodes: ["gate_grant_expansion_required"],
  };
}
