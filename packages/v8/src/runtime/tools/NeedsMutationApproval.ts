import type { GrantSurface } from "./CheckToolAgainstGrant";
import type { ToolEffectClass } from "./ClassifyToolEffect";

/**
 * Whether a mutate tool must pause for host approval under the grant.
 * `never` → execute; `every_mutation` / `when_required` → suspend.
 */
export function needsMutationApproval(params: {
  effect: ToolEffectClass;
  grant: GrantSurface;
}): boolean {
  if (params.effect !== "mutate") return false;
  const mode = params.grant.approvalMode ?? "never";
  return mode === "every_mutation" || mode === "when_required";
}
