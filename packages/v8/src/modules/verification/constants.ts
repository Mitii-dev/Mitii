/**
 * Stable identifiers for Verification.
 */
export const VERIFICATION_SCHEMA_VERSION = 1 as const;

export const VERIFICATION_STATUSES = [
  "verified_success",
  "implemented_unverified",
  "verification_failed",
  "blocked",
  "cancelled",
] as const;

export const VERIFICATION_CHECK_KINDS = [
  "syntax",
  "diagnostics",
  "typecheck",
  "lint",
  "format",
  "test",
  "build",
  "diff_review",
] as const;

export const VERIFICATION_CHECK_OUTCOMES = [
  "passed",
  "failed",
  "skipped",
  "unavailable",
  "timed_out",
  "cancelled",
] as const;

export const VERIFICATION_CHANGE_SCOPES = [
  "localized",
  "module",
  "cross_cutting",
  "public_api",
] as const;

export const VERIFICATION_DIAGNOSTIC_SEVERITIES = [
  "error",
  "warning",
  "info",
  "hint",
] as const;

export const VERIFICATION_REASON_CODES = [
  "verification_not_required",
  "checks_passed",
  "checks_failed",
  "checks_unavailable",
  "checks_timed_out",
  "no_applicable_checks",
  "stale_state_risk",
  "state_unavailable",
  "grant_insufficient",
  "narrow_scope_selected",
  "expanded_scope_selected",
  "diff_reviewed",
  "cancelled",
  "missing_tool_degraded",
] as const;

export const VERIFICATION_ERROR_CODES = [
  "invalid_input",
  "misconfigured_ports",
  "execution_failed",
] as const;
