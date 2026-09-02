/**
 * Stable identifiers for Skills.
 */
export const SKILLS_SCHEMA_VERSION = 1 as const;

export const SKILL_SELECTION_STATUSES = [
  "selected",
  "empty",
  "blocked",
] as const;

export const SKILL_OMISSION_REASONS = [
  "budget",
  "required_budget",
  "conflict",
  "not_applicable",
  "not_found",
  "disabled",
  "duplicate",
  "empty_content",
] as const;

export const SKILL_SELECTION_KINDS = [
  "required",
  "matched",
  "always_apply",
] as const;

export const SKILL_REASON_CODES = [
  "skills_selected",
  "skills_required",
  "skills_required_not_found",
  "skills_required_partial",
  "no_matching_skills",
  "budget_omitted_skills",
  "skills_compacted",
  "skills_truncated_to_budget",
  "conflicts_resolved",
  "catalog_empty",
] as const;

/** Maximum explicitly attached skills per run (prompt, CLI, or host field). */
export const MAX_REQUIRED_SKILLS = 3;

export const SKILLS_ERROR_CODES = [
  "invalid_input",
  "misconfigured_ports",
  "catalog_failed",
] as const;
