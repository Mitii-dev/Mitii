/** Soft token budget for the memory section before Prompt Construction. */
export const DEFAULT_MEMORY_BUDGET_TOKENS = 600;

/** Hard cap on how many memory facts may be selected for one turn. */
export const DEFAULT_MAX_MEMORY_FACTS = 5;

/** Characters-per-token estimate used when no estimator is injected. */
export const DEFAULT_CHARACTERS_PER_TOKEN = 4;

/** Minimum relevance score required to include a memory fact. */
export const DEFAULT_MIN_MEMORY_SCORE = 0.4;

/** Default retention window when commit omits expiresAt (30 days). */
export const DEFAULT_RETENTION_DAYS = 30;
