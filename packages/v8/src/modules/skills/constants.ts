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
  "conflict",
  "not_applicable",
  "duplicate",
  "empty_content",
] as const;

export const SKILL_REASON_CODES = [
  "skills_selected",
  "no_matching_skills",
  "budget_omitted_skills",
  "conflicts_resolved",
  "catalog_empty",
] as const;

export const SKILLS_ERROR_CODES = [
  "invalid_input",
  "misconfigured_ports",
  "catalog_failed",
] as const;
