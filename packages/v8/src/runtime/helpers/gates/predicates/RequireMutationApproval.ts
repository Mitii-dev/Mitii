import type { GateVerdict } from "../kinds";
import type { GateContext } from "../types";

export function requireMutationApproval(
  ctx: GateContext,
): GateVerdict | undefined {
  if (!ctx.needsMutationApproval) return undefined;
  return {
    action: "suspend",
    kind: "mutation_approval_required",
    payload: {},
    reasonCodes: ["gate_mutation_approval_required"],
  };
}
