import type { GrantSurface } from "./CheckToolAgainstGrant";
import type { ToolEffectClass } from "./ClassifyToolEffect";

/** High-impact mutates that Guided (when_required) still pauses on. */
const HIGH_IMPACT_MUTATE = new Set([
  "delete_file",
  "rename_file",
  "run_mutating_command",
]);

/**
 * Whether a mutate tool must pause for host approval under the grant.
 * - `never` (Full access / pilot) → execute
 * - `every_mutation` (Ask for approval / safe) → suspend every mutate
 * - `when_required` (Approve for me / guided) → auto-approve routine
 *   writes (apply_patch); still pause on high-impact deletes/renames
 */
export function needsMutationApproval(params: {
  effect: ToolEffectClass;
  grant: GrantSurface;
  toolId?: string;
}): boolean {
  if (params.effect !== "mutate") return false;
  const mode = params.grant.approvalMode ?? "never";
  if (mode === "never") return false;
  if (mode === "every_mutation") return true;
  // when_required
  if (params.toolId && HIGH_IMPACT_MUTATE.has(params.toolId)) return true;
  return false;
}
