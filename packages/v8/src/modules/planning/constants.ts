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

export const PLANNING_REASON_CODES = [
  "plan_drafted",
  "plan_validated",
  "plan_compacted",
  "plan_depth_none",
  "plan_open_questions",
  "plan_process_hints_applied",
  "plan_skills_considered",
  "plan_sections_required",
  "plan_blocked_invalid",
] as const;

export const PLANNING_ERROR_CODES = [
  "invalid_input",
  "invalid_plan",
  "misconfigured",
] as const;
