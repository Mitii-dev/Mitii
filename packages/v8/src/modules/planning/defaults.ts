/** Soft token budget for a serialized plan section. */
export const DEFAULT_PLANNING_BUDGET_TOKENS = 1_200;

/** Characters-per-token estimate when no estimator is injected. */
export const DEFAULT_PLAN_CHARACTERS_PER_TOKEN = 4;

/** Maximum phases retained after compaction. */
export const DEFAULT_MAX_PLAN_PHASES = 6;

/** Maximum steps per phase retained after compaction. */
export const DEFAULT_MAX_STEPS_PER_PHASE = 8;

/** Maximum open questions retained on a visible plan. */
export const DEFAULT_MAX_OPEN_QUESTIONS = 5;
