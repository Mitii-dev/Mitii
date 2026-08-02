import {
  CONTEXT_SELECTION_DEFAULTS,
  CONTEXT_SELECTION_LIMITS,
} from "./internal/context-selection/constants";
import type { ContextSelectionBudget } from "./internal/context-selection/types";

/**
 * Public selection-budget policy for callers (Agent Engine) that scale
 * repository context selection with the active model context window.
 */
export const REPOSITORY_CONTEXT_BUDGET_POLICY = {
  /** Fraction of model context window used for repository selection tokens. */
  selectionBudgetContextWindowRatio: 0.25,
} as const;

/**
 * Derive a ContextSelectionBudget from the active model context window.
 * Floors at CONTEXT_SELECTION_DEFAULTS and caps at CONTEXT_SELECTION_LIMITS.
 */
export function deriveContextSelectionBudget(
  contextWindowTokens: number,
): ContextSelectionBudget {
  const safeWindow = Math.max(0, Math.floor(contextWindowTokens));
  const proportionalTokens = Math.floor(
    safeWindow *
      REPOSITORY_CONTEXT_BUDGET_POLICY.selectionBudgetContextWindowRatio,
  );
  const maximumTokens = Math.min(
    CONTEXT_SELECTION_LIMITS.MAXIMUM_TOKENS,
    Math.max(CONTEXT_SELECTION_DEFAULTS.MAXIMUM_TOKENS, proportionalTokens),
  );
  const budgetScale =
    maximumTokens / CONTEXT_SELECTION_DEFAULTS.MAXIMUM_TOKENS;

  return {
    maximumTokens,
    maximumItems: Math.min(
      CONTEXT_SELECTION_LIMITS.MAXIMUM_ITEMS,
      Math.ceil(CONTEXT_SELECTION_DEFAULTS.MAXIMUM_ITEMS * budgetScale),
    ),
    maximumFiles: Math.min(
      CONTEXT_SELECTION_LIMITS.MAXIMUM_FILES,
      Math.ceil(CONTEXT_SELECTION_DEFAULTS.MAXIMUM_FILES * budgetScale),
    ),
  };
}
