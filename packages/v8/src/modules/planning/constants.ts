/**
 * Stable identifiers for Planning.
 */
export const PLANNING_SCHEMA_VERSION = 1 as const;

export const PLANNING_MESSAGES = {
  inputInvalid: "Planning input failed schema validation.",
} as const;

/**
 * Named accessors for frequently logged reason codes.
 * Full catalog remains {@link PLANNING_REASON_CODES}.
 */
export const PLANNING_REASON = {
  drafted: "plan_drafted",
  depthNone: "plan_depth_none",
  draftedFromDiscovery: "plan_drafted_from_discovery",
  discoveryDraftFailed: "plan_discovery_draft_failed_fallback",
  clarifyDrafted: "plan_clarify_drafted",
  blockedInvalid: "plan_blocked_invalid",
} as const;

/** Ordered flow stage names (plan path + logger). */
export const PLANNING_STAGES = {
  resolveStrategy: "1-resolve-strategy",
  draftSkeleton: "2-draft-skeleton",
  applyDiscoveryDraft: "3-apply-discovery-draft",
  enforceDiscoveryQuality: "4-enforce-discovery-quality",
  draftClarify: "5-draft-clarify",
  validatePlan: "6-validate-plan",
  applyWorkingSets: "7-apply-working-sets",
  compactPlan: "8-compact-plan",
  finalizeResult: "9-finalize-result",
} as const;

export type PlanningStageName =
  (typeof PLANNING_STAGES)[keyof typeof PLANNING_STAGES];

export const PLANNING_STATUSES = [
  "drafted",
  "validated",
  "compacted",
  "blocked",
] as const;

export const PLAN_STEP_RISK_LEVELS = [
  "low",
  "medium",
  "high",
  "critical",
] as const;

export const PLAN_CHANGE_IMPACTS = [
  "code",
  "config",
  "data",
  "infra",
  "security",
  "ux",
] as const;

export const PLAN_CONTEXT_KINDS = [
  "file",
  "folder",
  "symbol",
  "doc",
  "git_diff",
  "test",
  "log",
  "api",
  "other",
] as const;

export const PLAN_STRATEGIES = [
  "follow_evidence",
  "discover_and_plan",
  "plan_from_ask",
  "clarify",
] as const;

export const PLANNING_REASON_CODES = [
  "plan_drafted",
  "plan_validated",
  "plan_compacted",
  "plan_depth_none",
  "plan_open_questions",
  "plan_process_hints_applied",
  "plan_skills_considered",
  "plan_diagnostics_considered",
  "plan_sections_required",
  "plan_blocked_invalid",
  "plan_strategy_follow_evidence",
  "plan_strategy_discover_and_plan",
  "plan_strategy_plan_from_ask",
  "plan_strategy_clarify",
  "plan_strategy_rules",
  "plan_strategy_override",
  "plan_build_evidence_out_of_scope",
  "plan_discovery_applied",
  "plan_discovery_insufficient",
  "plan_drafted_from_discovery",
  "plan_discovery_draft_failed_fallback",
  "plan_discovery_draft_skipped_thin_brief",
  "plan_discovery_draft_required_clarify",
  "plan_clarify_drafted",
  "plan_clarify_draft_fallback",
  "plan_verify_phase_required",
  "plan_working_set_applied",
  "plan_working_set_empty",
  "plan_strategy_known_paths",
  "plan_strategy_medium_bounded_discover",
  "plan_steps_concrete",
  "plan_steps_missing_targets",
  "plan_steps_vague_targets",
  "plan_steps_missing_verification",
] as const;

export const PLANNING_ERROR_CODES = [
  "invalid_input",
  "invalid_plan",
  "misconfigured",
] as const;
