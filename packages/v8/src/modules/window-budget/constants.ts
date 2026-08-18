/**
 * Stable identifiers for Window Budget.
 */
export const WINDOW_BUDGET_SCHEMA_VERSION = 1 as const;

/**
 * Historical host default that truncates apply_patch batches on 30k–50k
 * windows. Window Budget treats this exact value as unset and derives O.
 */
export const LEGACY_DEFAULT_MAXIMUM_OUTPUT_TOKENS = 5_000;

export const WINDOW_BUDGET_REASON_CODES = [
  "output_derived_from_window",
  "output_host_override",
  "output_legacy_default_ignored",
  "tool_schema_measured",
  "tool_schema_fallback",
  "usable_input_clamped",
  "effort_low",
  "effort_medium",
  "effort_high",
  "mutation_effort_capped",
  "repository_tokens_capped",
  "plan_tokens_capped",
  "skills_tokens_capped",
] as const;

export const WINDOW_BUDGET_ERROR_CODES = ["invalid_input"] as const;
