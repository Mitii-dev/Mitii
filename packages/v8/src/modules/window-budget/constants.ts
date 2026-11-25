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
  "mode_ask",
  "mode_plan",
  "mode_agent",
  "model_profile_applied",
  "mutation_effort_capped",
  "repository_tokens_capped",
  "plan_tokens_capped",
  "skills_tokens_capped",
] as const;

export type WindowBudgetReasonCodeConst =
  (typeof WINDOW_BUDGET_REASON_CODES)[number];

/** Named reason-code accessors — never build codes with string templates. */
export const WINDOW_BUDGET_REASON = {
  outputDerivedFromWindow: "output_derived_from_window",
  outputHostOverride: "output_host_override",
  outputLegacyDefaultIgnored: "output_legacy_default_ignored",
  toolSchemaMeasured: "tool_schema_measured",
  toolSchemaFallback: "tool_schema_fallback",
  usableInputClamped: "usable_input_clamped",
  modelProfileApplied: "model_profile_applied",
  mutationEffortCapped: "mutation_effort_capped",
  repositoryTokensCapped: "repository_tokens_capped",
  planTokensCapped: "plan_tokens_capped",
  skillsTokensCapped: "skills_tokens_capped",
} as const satisfies Record<string, WindowBudgetReasonCodeConst>;

export const WINDOW_BUDGET_EFFORT_REASON = {
  low: "effort_low",
  medium: "effort_medium",
  high: "effort_high",
} as const satisfies Record<"low" | "medium" | "high", WindowBudgetReasonCodeConst>;

export const WINDOW_BUDGET_MODE_REASON = {
  ask: "mode_ask",
  plan: "mode_plan",
  agent: "mode_agent",
} as const satisfies Record<"ask" | "plan" | "agent", WindowBudgetReasonCodeConst>;

/** Ordered flow stage names (also used in logs / optional WindowPolicy.stages). */
export const WINDOW_BUDGET_STAGES = {
  resolvePolicy: "1-resolve-policy",
  deriveAllocation: "2-derive-allocation",
  resolveGenerationCeiling: "3-resolve-generation-ceiling",
} as const;

export const WINDOW_BUDGET_ERROR_CODES = ["invalid_input"] as const;
