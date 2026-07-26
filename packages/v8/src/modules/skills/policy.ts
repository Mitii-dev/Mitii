import {
  DEFAULT_MAX_SKILLS,
  DEFAULT_MIN_SKILL_SCORE,
  DEFAULT_SKILLS_BUDGET_TOKENS,
} from "./defaults";

export const SKILLS_THRESHOLDS = {
  defaultBudgetTokens: DEFAULT_SKILLS_BUDGET_TOKENS,
  defaultMaxSkills: DEFAULT_MAX_SKILLS,
  minimumMatchScore: DEFAULT_MIN_SKILL_SCORE,
  /** Weight for primary intent match. */
  primaryIntentWeight: 1,
  /** Weight for secondary intent match. */
  secondaryIntentWeight: 0.55,
  /** Weight for execution route match. */
  routeWeight: 0.7,
  /** Weight for keyword/tag overlap with the user message. */
  keywordWeight: 0.4,
  /** Always-apply skills receive this base score before other signals. */
  alwaysApplyBaseScore: 1,
} as const;
