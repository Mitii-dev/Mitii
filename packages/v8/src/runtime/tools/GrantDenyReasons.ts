/** Exact deny surface for policy-stateless tool runtime (§5.12.12). */
export const GRANT_DENY_REASONS = [
  "tool_not_allowed",
  "effect_not_granted",
  "path_out_of_scope",
  "protected_path",
  "command_not_allowed",
  "network_not_allowed",
  "budget_exceeded",
  "mutation_budget_exceeded",
  "approval_required",
] as const;

export type GrantDenyReason = (typeof GRANT_DENY_REASONS)[number];

export function isGrantDenyReason(value: string): value is GrantDenyReason {
  return (GRANT_DENY_REASONS as readonly string[]).includes(value);
}
