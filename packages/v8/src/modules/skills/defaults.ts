/** Soft token budget for selected L2 skill bodies before Prompt Construction. */
export const DEFAULT_SKILLS_BUDGET_TOKENS = 2400;

/** Hard cap on how many skills may be selected for one turn. */
export const DEFAULT_MAX_SKILLS = 2;

/** Max L1 catalog entries returned when includeCatalogL1 is set. */
export const DEFAULT_SKILL_CATALOG_L1_MAX_ENTRIES = 40;

/** Characters-per-token estimate used when no estimator is injected. */
export const DEFAULT_CHARACTERS_PER_TOKEN = 4;

/** Minimum match score required to load a non-always-apply skill. */
export const DEFAULT_MIN_SKILL_SCORE = 0.35;

/**
 * Smallest compact skill body still worth injecting when the full playbook
 * does not fit. Below this, omit rather than emit a stub.
 */
export const DEFAULT_MIN_USEFUL_SKILL_TOKENS = 32;
