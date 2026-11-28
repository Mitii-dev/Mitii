import type { GateVerdict } from "../kinds";
import type { GateContext } from "../types";

export function requireMutationApproval(
  ctx: GateContext,
): GateVerdict | undefined {
  if (!ctx.needsMutationApproval) return undefined;
  // Destructive promotes to its own kind when extended gates are on.
  if (ctx.enableExtendedGates && ctx.needsDestructiveApproval) {
    return undefined;
  }
  const approvalClass = ctx.needsDestructiveApproval
    ? "destructive"
    : "mutation";
  return {
    action: "suspend",
    kind: "mutation_approval_required",
    payload: { approvalClass },
    reasonCodes: [
      "gate_mutation_approval_required",
      ...(approvalClass === "destructive"
        ? ["gate_mutation_approval_class_destructive"]
        : []),
    ],
  };
}
