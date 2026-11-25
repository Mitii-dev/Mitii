import type { TokenEstimatorPort } from "../contracts";
import { TRUNCATION_MARKER } from "../defaults";
import { PROMPT_CONSTRUCTION_THRESHOLDS } from "../rules";

export function truncateToTokenBudget(
  content: string,
  budgetTokens: number,
  estimator: TokenEstimatorPort,
): { content: string; usedTokens: number; truncatedTokens: number } {
  if (budgetTokens <= 0) {
    return {
      content: "",
      usedTokens: 0,
      truncatedTokens: estimator.estimate(content),
    };
  }

  const fullTokens = estimator.estimate(content);
  if (fullTokens <= budgetTokens) {
    return { content, usedTokens: fullTokens, truncatedTokens: 0 };
  }

  // Approximate chars from token budget using the estimator's observed density.
  const density = content.length / Math.max(1, fullTokens);
  let charBudget = Math.max(0, Math.floor(budgetTokens * density) - TRUNCATION_MARKER.length);
  if (charBudget <= 0) {
    return {
      content: "",
      usedTokens: 0,
      truncatedTokens: fullTokens,
    };
  }

  let sliced = content.slice(0, charBudget) + TRUNCATION_MARKER;
  while (
    estimator.estimate(sliced) > budgetTokens &&
    charBudget > 0
  ) {
    charBudget = Math.floor(charBudget * 0.9);
    sliced = content.slice(0, charBudget) + TRUNCATION_MARKER;
  }

  const usedTokens = estimator.estimate(sliced);
  return {
    content: sliced,
    usedTokens,
    truncatedTokens: Math.max(0, fullTokens - usedTokens),
  };
}

/**
 * Truncate while keeping both ends. Large pastes (configs, logs) usually put
 * the actionable ask or error after a long body; head-only truncation drops it.
 */
export function truncateKeepingEnds(
  content: string,
  budgetTokens: number,
  estimator: TokenEstimatorPort,
  options?: { tailKeepRatio?: number },
): { content: string; usedTokens: number; truncatedTokens: number } {
  if (budgetTokens <= 0) {
    return {
      content: "",
      usedTokens: 0,
      truncatedTokens: estimator.estimate(content),
    };
  }

  const fullTokens = estimator.estimate(content);
  if (fullTokens <= budgetTokens) {
    return { content, usedTokens: fullTokens, truncatedTokens: 0 };
  }

  const tailKeepRatio = clampRatio(
    options?.tailKeepRatio ??
      PROMPT_CONSTRUCTION_THRESHOLDS.userRequestTailKeepRatio,
  );
  const density = content.length / Math.max(1, fullTokens);
  let charBudget = Math.max(
    0,
    Math.floor(budgetTokens * density) - TRUNCATION_MARKER.length,
  );
  if (charBudget <= 0) {
    return {
      content: "",
      usedTokens: 0,
      truncatedTokens: fullTokens,
    };
  }

  const build = (budget: number): string => {
    const tailChars = Math.max(1, Math.floor(budget * tailKeepRatio));
    const headChars = Math.max(0, budget - tailChars);
    if (headChars <= 0) {
      return `${TRUNCATION_MARKER.trimStart()}${content.slice(-tailChars)}`;
    }
    return (
      content.slice(0, headChars) +
      TRUNCATION_MARKER +
      content.slice(-tailChars)
    );
  };

  let sliced = build(charBudget);
  while (estimator.estimate(sliced) > budgetTokens && charBudget > 0) {
    charBudget = Math.floor(charBudget * 0.9);
    sliced = build(charBudget);
  }

  const usedTokens = estimator.estimate(sliced);
  return {
    content: sliced,
    usedTokens,
    truncatedTokens: Math.max(0, fullTokens - usedTokens),
  };
}

function clampRatio(value: number): number {
  if (!Number.isFinite(value)) {
    return 0.7;
  }
  return Math.min(0.95, Math.max(0.05, value));
}
