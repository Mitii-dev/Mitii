/** Soft token budget for the memory section before Prompt Construction. */
export const DEFAULT_MEMORY_BUDGET_TOKENS = 600;

/** Hard cap on how many memory facts may be selected for one turn. */
export const DEFAULT_MAX_MEMORY_FACTS = 5;

/** Characters-per-token estimate used when no estimator is injected. */
export const DEFAULT_CHARACTERS_PER_TOKEN = 4;

/**
 * Legacy overlap floor. Retrieve now ranks with BM25; this remains exported
 * for hosts that still display a simple relevance cutoff.
 */
export const DEFAULT_MIN_MEMORY_SCORE = 0.4;

/**
 * Optional explicit TTL when a host sets expiresAt via days.
 * Commits no longer apply this as a hard default (access decay ranks instead).
 */
export const DEFAULT_RETENTION_DAYS = 30;

/** Cap on persisted access timestamps used for retention boost. */
export const DEFAULT_MAX_ACCESS_LOG = 20;

/** Characters sent to an embedding port for one fact or query. */
export const DEFAULT_EMBED_MAX_CHARS = 16_000;

/** Default importance when commit omits it. */
export const DEFAULT_MEMORY_IMPORTANCE = 5;

/** Cap on concepts derived from free-text content at commit time. */
export const DEFAULT_MAX_DERIVED_CONCEPTS = 12;
