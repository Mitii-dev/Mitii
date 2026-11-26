/**
 * S11-LOOP — consult hub after_tool before settle/suspend (never inline kinds).
 */

import { evaluateGates } from "../gates";
import type { GateVerdict } from "../gates/kinds";
import type { GrantDenyReason } from "../../tools/GrantDenyReasons";
import type { ToolEffectClass } from "../../tools/ClassifyToolEffect";
import { needsMutationApproval } from "../../tools/NeedsMutationApproval";
import type { GrantSurface } from "../../tools/CheckToolAgainstGrant";

const EXPANSION_REASONS = new Set<GrantDenyReason>([
  "path_out_of_scope",
  "protected_path",
  "command_not_allowed",
  "network_not_allowed",
]);

export function evaluateAfterToolGate(input: {
  runId: string;
  mode?: "ask" | "plan" | "agent";
  route?: string;
  effect: ToolEffectClass;
  grant: GrantSurface;
  denyReason?: GrantDenyReason;
  enableExtendedGates?: boolean;
  /** External / network side-effect needing host OK. */
  needsExternalSideEffectApproval?: boolean;
  /** Destructive class (delete / force-push). */
  needsDestructiveApproval?: boolean;
}): GateVerdict | undefined {
  const needsExpansion =
    input.denyReason != null && EXPANSION_REASONS.has(input.denyReason);
  const needsMut = needsMutationApproval({
    effect: input.effect,
    grant: input.grant,
  });

  if (
    !needsExpansion &&
    !needsMut &&
    !input.needsExternalSideEffectApproval &&
    !input.needsDestructiveApproval
  ) {
    return undefined;
  }

  return evaluateGates("after_tool", {
    runId: input.runId,
    mode: input.mode,
    route: input.route,
    needsGrantExpansion: needsExpansion,
    needsMutationApproval: needsMut,
    needsExternalSideEffectApproval: input.needsExternalSideEffectApproval,
    needsDestructiveApproval: input.needsDestructiveApproval,
    enableExtendedGates: input.enableExtendedGates,
  });
}
