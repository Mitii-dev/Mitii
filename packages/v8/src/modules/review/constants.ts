export const REVIEW_SCHEMA_VERSION = 1 as const;
export const REVIEW_RECORD_SCHEMA_VERSION = "mitii.review/v1" as const;

export const REVIEW_MODES = ["workspace", "range", "commit", "scan"] as const;

export const REVIEW_EFFORTS = ["low", "medium", "high"] as const;

export const REVIEW_CATEGORIES = [
  "bug",
  "security",
  "performance",
  "maintainability",
  "test",
  "style",
  "documentation",
  "other",
] as const;

export const REVIEW_SEVERITIES = [
  "critical",
  "high",
  "medium",
  "low",
] as const;

export const REVIEW_EXCLUDE_REASONS = [
  "none",
  "binary",
  "user_exclude",
  "unsupported_ext",
  "default_path",
  "deleted",
  "too_large",
] as const;

export const REVIEW_STATUSES = [
  "ok",
  "partial",
  "empty",
  "preview",
] as const;

export const REVIEW_RECORD_STATUSES = [
  "prepared",
  "complete",
  "partial",
  "failed",
  "cancelled",
] as const;

export const REVIEW_REASON_CODES = [
  "review_prepared",
  "review_preview",
  "review_complete",
  "review_partial",
  "no_reviewable_files",
  "findings_anchored",
  "findings_unanchored",
  "rules_resolved",
  "groups_formed",
  "budget_limited",
  "scan_batched",
] as const;

export const REVIEW_ERROR_CODES = [
  "invalid_input",
  "misconfigured",
  "store_failed",
  "diff_unavailable",
] as const;

export const REVIEW_WARNING_CODES = [
  "anchor_failed",
  "repair_applied",
  "reflect_skipped",
  "group_fallback",
  "rule_missing",
  "finding_truncated",
] as const;

export const REVIEW_SARIF_TOOL_NAME = "Mitii";
export const REVIEW_SARIF_INFORMATION_URI = "https://docs.mitii.dev";
export const REVIEW_SARIF_FINGERPRINT_KEY = "mitiiFinding/v1";
