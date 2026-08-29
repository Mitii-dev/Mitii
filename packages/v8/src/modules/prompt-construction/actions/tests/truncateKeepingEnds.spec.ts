import { describe, expect, it } from "vitest";

import {
  truncateKeepingEnds,
  truncateToTokenBudget,
} from "../BuildSystemAndConversation";
import { CharacterTokenEstimator } from "../../internal/CharacterTokenEstimator";

describe("truncateKeepingEnds", () => {
  const estimator = new CharacterTokenEstimator();

  it("keeps the trailing ask when truncating a large paste", () => {
    const body = `{"cfg":"${"x".repeat(8_000)}"}`;
    const ask = "Please, specify correct config params:";
    const content = `${body}\n\n${ask}`;
    const fullTokens = estimator.estimate(content);
    const budget = Math.floor(fullTokens / 4);

    const truncated = truncateKeepingEnds(content, budget, estimator);
    expect(truncated.truncatedTokens).toBeGreaterThan(0);
    expect(truncated.content).toContain(ask);
    expect(truncated.content).toContain("…[truncated for context budget]");
    expect(truncated.usedTokens).toBeLessThanOrEqual(budget);
  });

  it("matches head-only truncation when the budget already fits", () => {
    const content = "short request";
    const budget = estimator.estimate(content) + 10;
    expect(truncateKeepingEnds(content, budget, estimator)).toEqual(
      truncateToTokenBudget(content, budget, estimator),
    );
  });
});
