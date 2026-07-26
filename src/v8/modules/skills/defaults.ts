/** Soft token budget for the skills section before Prompt Construction. */
export const DEFAULT_SKILLS_BUDGET_TOKENS = 800;

/** Hard cap on how many skills may be selected for one turn. */
export const DEFAULT_MAX_SKILLS = 3;

/** Characters-per-token estimate used when no estimator is injected. */
export const DEFAULT_CHARACTERS_PER_TOKEN = 4;

/** Minimum match score required to load a non-always-apply skill. */
export const DEFAULT_MIN_SKILL_SCORE = 0.35;
