import type { GateVerdict } from "../kinds";
import type { GateContext } from "../types";

export function requireCheckpointConflict(
  ctx: GateContext,
): GateVerdict | undefined {
  if (!ctx.checkpointConflict) return undefined;
  return {
    action: "suspend",
    kind: "checkpoint_conflict_required",
    payload: {},
    reasonCodes: ["gate_checkpoint_conflict_required"],
  };
}
