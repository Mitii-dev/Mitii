/**
 * S10-POLICY-MAP — non-suspend policy concerns → owner modules (§10.3.2).
 * No new suspension kinds; escalate only into existing core/extended kinds.
 */

export const POLICY_GATE_CONCERNS = [
  "mode_capability_seal",
  "scope_protected_path",
  "plan_quality",
  "verification_regression",
  "blast_radius",
  "external_destructive_class",
  "auth_dependency",
  "checkpoint_freshness",
] as const;

export type PolicyGateConcern = (typeof POLICY_GATE_CONCERNS)[number];

export interface PolicyGateOwner {
  concern: PolicyGateConcern;
  /** Module or runtime helper that owns the check. */
  owner: string;
  /** Existing hub kinds this may escalate into (empty = clamp/deny only). */
  escalateKinds: readonly string[];
  notes: string;
}

export const POLICY_GATE_OWNER_MAP: readonly PolicyGateOwner[] = [
  {
    concern: "mode_capability_seal",
    owner: "decision-policy/plates",
    escalateKinds: ["clarification_required"],
    notes: "Clamp grant or force clarify/answer/plan route",
  },
  {
    concern: "scope_protected_path",
    owner: "decision-policy + runtime/tools",
    escalateKinds: [
      "grant_expansion_required",
      "mutation_approval_required",
      "destructive_action_required",
    ],
    notes: "Deny tool or escalate grant/mutation/destructive",
  },
  {
    concern: "plan_quality",
    owner: "modules/planning",
    escalateKinds: ["clarification_required"],
    notes: "Hollow plan → clarify or bounded rediscovery",
  },
  {
    concern: "verification_regression",
    owner: "modules/verification",
    escalateKinds: ["continue_required"],
    notes: "Repair capped → continue_required when host opts in",
  },
  {
    concern: "blast_radius",
    owner: "runtime/helpers/rails/blast-radius",
    escalateKinds: [
      "mutation_approval_required",
      "destructive_action_required",
    ],
    notes: "assessBlastRadius flags — not a new suspend kind",
  },
  {
    concern: "external_destructive_class",
    owner: "runtime/tools effect + grant policy",
    escalateKinds: [
      "external_side_effect_required",
      "destructive_action_required",
      "mutation_approval_required",
    ],
    notes: "Extended gates when enableExtendedGates",
  },
  {
    concern: "auth_dependency",
    owner: "tools/MCP attach",
    escalateKinds: ["auth_or_dependency_required"],
    notes: "Mid-run MCP revoke → hub when extended",
  },
  {
    concern: "checkpoint_freshness",
    owner: "runtime/helpers/checkpoint",
    escalateKinds: ["checkpoint_conflict_required"],
    notes: "on_resume epoch/pin/git drift",
  },
] as const;

export function resolvePolicyGateOwner(
  concern: PolicyGateConcern,
): PolicyGateOwner | undefined {
  return POLICY_GATE_OWNER_MAP.find((row) => row.concern === concern);
}
