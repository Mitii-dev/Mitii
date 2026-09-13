import { describe, expect, it } from "vitest";

import { CharacterTokenEstimator } from "../../../../modules/prompt-construction";
import { deriveWindowPolicy } from "../../../../modules/window-budget";
import { compactModelLoopMessagesFromWindowPolicy } from "../compactModelLoopMessages";
import type { ModelMessage } from "../../../../modules/model-gateway";

const estimator = new CharacterTokenEstimator();

describe("compactModelLoopMessagesFromWindowPolicy", () => {
  it("uses WindowPolicy.compaction thresholds only", () => {
    const policy = deriveWindowPolicy({
      schemaVersion: 1,
      contextWindowTokens: 32_000,
    });

    const messages: ModelMessage[] = [
      { role: "system", content: "system" },
      { role: "user", content: "x".repeat(Math.min(8_000, policy.loopInputBudgetTokens)) },
    ];

    const result = compactModelLoopMessagesFromWindowPolicy({
      messages,
      estimator,
      budgetTokens: policy.loopInputBudgetTokens,
      compaction: policy.compaction,
    });

    expect(result.thresholds.warnTokens).toBe(
      Math.floor(policy.loopInputBudgetTokens * policy.compaction.warnRatio),
    );
    expect(Array.isArray(result.stagesApplied)).toBe(true);
  });
});
