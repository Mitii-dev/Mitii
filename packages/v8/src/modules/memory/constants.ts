/**
 * Stable identifiers for Memory.
 */
export const MEMORY_SCHEMA_VERSION = 2 as const;

export const MEMORY_SCOPES = ["user", "workspace", "project"] as const;

export const MEMORY_PRIVACY_LEVELS = ["private", "shareable"] as const;

export const MEMORY_FACT_TYPES = [
  "pattern",
  "preference",
  "architecture",
  "bug",
  "workflow",
  "fact",
] as const;

export const MEMORY_RETRIEVAL_STATUSES = [
  "retrieved",
  "empty",
  "blocked",
] as const;

export const MEMORY_COMMIT_STATUSES = [
  "committed",
  "rejected",
  "blocked",
] as const;

export const MEMORY_OMISSION_REASONS = [
  "budget",
  "irrelevant",
  "stale",
  "privacy",
  "scope_mismatch",
  "duplicate",
  "retention",
  "superseded",
] as const;

export const MEMORY_REASON_CODES = [
  "memory_retrieved",
  "no_relevant_memory",
  "budget_omitted_memory",
  "stale_memory_filtered",
  "privacy_filtered",
  "store_empty",
  "memory_committed",
  "commit_rejected",
  "memory_bm25_only",
  "memory_file_boosted",
  "memory_hybrid",
  "memory_superseded",
  "privacy_redacted",
  "memory_duplicate",
  "memory_reinforced",
] as const;

export const MEMORY_ERROR_CODES = [
  "invalid_input",
  "misconfigured_ports",
  "store_failed",
] as const;
