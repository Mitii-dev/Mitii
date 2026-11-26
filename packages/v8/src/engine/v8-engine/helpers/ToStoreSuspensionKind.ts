import { mapLegacySuspensionKind } from "../../../runtime/helpers/gates";

import type { AgentRunCheckpoint } from "../internal/RunCheckpoint";

type StoreSuspensionKind = AgentRunCheckpoint["suspensionKind"];

/**
 * Map hub GateKind → today's AgentRunCheckpoint.suspensionKind wire values.
 * Hub uses mutation_approval_required; store still writes approval_required.
 */
export function toStoreSuspensionKind(kind: string): StoreSuspensionKind {
  const hub = mapLegacySuspensionKind(kind) ?? kind;
  if (hub === "mutation_approval_required") {
    return "approval_required";
  }
  const allowed: StoreSuspensionKind[] = [
    "approval_required",
    "clarification_required",
    "plan_approval_required",
    "grant_expansion_required",
    "continue_required",
  ];
  if ((allowed as string[]).includes(hub)) {
    return hub as StoreSuspensionKind;
  }
  throw new Error(`Unknown suspension kind for checkpoint store: ${kind}`);
}
