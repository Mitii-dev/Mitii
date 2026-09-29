/** Schema marker for v8-engine run artifacts (compatible hosts may ignore). */
export const V8_ENGINE_SCHEMA_VERSION = 1 as const;

export const V8_ENGINE_IMPLEMENTATIONS = ["legacy", "v8"] as const;
export type V8EngineImplementation = (typeof V8_ENGINE_IMPLEMENTATIONS)[number];

/**
 * Extra reason codes introduced by v8-engine. Hosts that only know
 * agent-engine codes should ignore unknown strings.
 */
export const V8_ENGINE_REASON_CODES = [
  "v8_engine_selected",
  "v8_not_implemented",
  "user_paths_beat_preflight",
  "tool_loop_soft",
  "tool_loop_force_final",
  "tool_loop_detected",
  "reasoning_progress_budget_exceeded",
  "truncation_recovered",
  "truncation_counter_reset_on_tools",
] as const;

export type V8EngineReasonCode = (typeof V8_ENGINE_REASON_CODES)[number];
