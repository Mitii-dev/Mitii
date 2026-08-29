/**
 * Stable identifiers for Prompt Construction.
 */
export const PROMPT_CONSTRUCTION_SCHEMA_VERSION = 1 as const;

export const PROMPT_SECTIONS = [
  "system",
  "rules",
  "skills",
  "memory",
  "conversation",
  "repository",
  "tools",
  "output_reserve",
] as const;

export const PROMPT_TRUST_LEVELS = [
  "trusted_instruction",
  "conversation",
  "untrusted_repository_content",
  "untrusted_tool_content",
] as const;

export const PROMPT_OMISSION_REASONS = [
  "budget",
  "duplicate",
  "capability_unsupported",
  "empty",
  "not_required",
  "grant_empty",
] as const;

export const PROMPT_CONSTRUCTION_STATUSES = [
  "complete",
  "partial",
  "blocked",
] as const;

export const PROMPT_REASON_CODES = [
  "output_reserved_first",
  "dynamic_output_expanded",
  "dynamic_output_limited_by_context",
  "within_provider_limits",
  "partial_context_omitted",
  "tools_omitted_unsupported",
  "tools_filtered_by_grant",
  "repository_not_required",
  "repository_wrapped_untrusted",
  "conversation_compacted",
  "user_request_truncated",
  "blocked_required_overflow",
] as const;

export const PROMPT_CONSTRUCTION_ERROR_CODES = [
  "invalid_input",
  "budget_impossible",
  "serialization_failed",
] as const;
