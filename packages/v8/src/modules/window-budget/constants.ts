/**
 * Stable identifiers for Window Budget.
 */
export const WINDOW_BUDGET_SCHEMA_VERSION = 1 as const;

export const WINDOW_BUDGET_REASON_CODES = [
  "output_derived_from_window",
  "output_host_override",
  "tool_schema_measured",
  "tool_schema_fallback",
  "usable_input_clamped",
] as const;

export const WINDOW_BUDGET_ERROR_CODES = ["invalid_input"] as const;
