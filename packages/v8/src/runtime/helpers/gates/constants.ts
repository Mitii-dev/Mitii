/** Gate phases and kind catalogs (§10). */

export const GATE_PHASES = [
  "on_resume",
  "after_decide",
  "after_plan",
  "after_tool",
  "mid_loop",
  "on_budget",
  "after_verify",
] as const;

export type GatePhase = (typeof GATE_PHASES)[number];

export const CORE_GATE_KINDS = [
  "clarification_required",
  "plan_approval_required",
  "mutation_approval_required",
  "grant_expansion_required",
  "continue_required",
] as const;

export const EXTENDED_GATE_KINDS = [
  "external_side_effect_required",
  "destructive_action_required",
  "auth_or_dependency_required",
  "checkpoint_conflict_required",
] as const;

export const GATE_KINDS = [...CORE_GATE_KINDS, ...EXTENDED_GATE_KINDS] as const;

export type GateKind = (typeof GATE_KINDS)[number];

export const TERMINAL_KINDS = [
  "plan_ready_complete",
  "verification_complete",
  "continue_stopped",
  "plan_rejected",
  "cancelled",
] as const;

export type TerminalKind = (typeof TERMINAL_KINDS)[number];

export const CLARIFY_ORIGINS = [
  "early_decide",
  "scope_fork",
  "hollow_plan",
  "evidence_gap",
] as const;

export type ClarifyOrigin = (typeof CLARIFY_ORIGINS)[number];

export const CONTINUE_REASONS = [
  "budget_exhausted",
  "stalled_or_blocked",
  "incomplete_progress",
  "verification_repair_capped",
  "evidence_clarify",
  "provider_unavailable",
] as const;

export type ContinueReason = (typeof CONTINUE_REASONS)[number];

/** Legacy checkpoint string → hub kind (one-release shim). */
export const LEGACY_SUSPENSION_KIND_MAP = {
  approval_required: "mutation_approval_required",
} as const;
