import {
  DEFAULT_MAX_MEMORY_FACTS,
  DEFAULT_MIN_MEMORY_SCORE,
  DEFAULT_MEMORY_BUDGET_TOKENS,
  DEFAULT_RETENTION_DAYS,
} from "./defaults";

export const MEMORY_THRESHOLDS = {
  defaultBudgetTokens: DEFAULT_MEMORY_BUDGET_TOKENS,
  defaultMaxFacts: DEFAULT_MAX_MEMORY_FACTS,
  minimumRelevanceScore: DEFAULT_MIN_MEMORY_SCORE,
  defaultRetentionDays: DEFAULT_RETENTION_DAYS,
  tagOverlapWeight: 0.55,
  contentOverlapWeight: 0.45,
} as const;
