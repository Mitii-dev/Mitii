import type { GateVerdict } from "../kinds";
import type { GateContext } from "../types";

/**
 * Promote destructive mutations to a distinct suspend kind when extended gates
 * are on (S10-EXT-DESTRUCT). Otherwise mutation_approval_required still covers.
 */
export function requireDestructiveAction(
  ctx: GateContext,
): GateVerdict | undefined {
  if (!ctx.enableExtendedGates || !ctx.needsDestructiveApproval) {
    return undefined;
  }
  return {
    action: "suspend",
    kind: "destructive_action_required",
    payload: { approvalClass: "destructive" },
    reasonCodes: ["gate_destructive_action_required"],
  };
}
