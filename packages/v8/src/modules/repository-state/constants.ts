/**
 * Stable identifiers for Repository State publication.
 */
export const REPOSITORY_STATE_SCHEMA_VERSION = 1 as const;

export const REPOSITORY_STATE_READINESS = [
  "ready",
  "degraded",
  "unavailable",
] as const;

export const REPOSITORY_STATE_SCAN_COMPLETENESS = [
  "complete",
  "partial",
  "filtered",
  "truncated",
  "cancelled",
] as const;

export const REPOSITORY_CAPABILITY_IDS = [
  "catalog",
  "codeIndex",
  "textIndex",
  "vectorIndex",
  "graph",
  "map",
] as const;

export const REPOSITORY_CAPABILITY_STATUSES = [
  "ready",
  "degraded",
  "unavailable",
] as const;

export const REPOSITORY_STATE_REASON_CODES = [
  "scan_partial",
  "scan_filtered",
  "scan_truncated",
  "scan_cancelled",
  "capability_degraded",
  "capability_unavailable",
  "root_incomplete",
  "validation_failed",
  "unknown_state_token",
  "workspace_mismatch",
  "publication_cancelled",
  "concurrent_publication",
  "state_pinned",
  "state_not_found",
] as const;

export const REPOSITORY_STATE_ERROR_CODES = [
  "invalid_candidate",
  "unknown_state_token",
  "workspace_mismatch",
  "publication_cancelled",
  "state_immutable",
  "state_pinned",
  "state_not_found",
] as const;
