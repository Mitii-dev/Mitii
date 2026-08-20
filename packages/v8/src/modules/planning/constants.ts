/**
 * Stable identifiers for Planning.
 */
export const PLANNING_SCHEMA_VERSION = 1 as const;

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
  "plan_working_set_applied",
] as const;

export const PLANNING_ERROR_CODES = [
  "invalid_input",
  "invalid_plan",
  "misconfigured",
] as const;
