import { describe, expect, it } from "vitest";

import {
  WINDOW_BUDGET_SCHEMA_VERSION,
  deriveWindowPolicy,
} from "../../../../modules/window-budget";
import { agentRunBudgetSchema } from "../../../../engine/v8-engine/contracts";
import {
  applyExplorationSignal,
  calculateLoopInputBudgetTokens,
  clampRunBudget,
  toRunUsage,
} from "../../../helpers/budgets";

describe("clampRunBudget soft/hard", () => {
  const windowPolicy = deriveWindowPolicy({
    schemaVersion: WINDOW_BUDGET_SCHEMA_VERSION,
    contextWindowTokens: 30_000,
  });

  it("starts limited runs at the soft checkpoint", () => {
    const parsed = agentRunBudgetSchema.parse({
      unlimited: false,
      maxModelCalls: 500,
      maxToolCalls: 500,
      maxLoopIterations: 500,
    });
    const { budget } = clampRunBudget(parsed, windowPolicy);
    expect(budget.maxModelCalls).toBe(windowPolicy.run.maxModelCalls);
    expect(budget.hardMaxModelCalls).toBe(windowPolicy.run.hardMaxModelCalls);
    expect(budget.hardMaxModelCalls).toBeGreaterThan(budget.maxModelCalls);
  });

  it("lets unlimited rise to the hard ceiling, not soft", () => {
    const parsed = agentRunBudgetSchema.parse({
      unlimited: true,
      maxModelCalls: 500,
      maxToolCalls: 500,
      maxLoopIterations: 500,
    });
    const { budget } = clampRunBudget(parsed, windowPolicy);
    expect(budget.maxModelCalls).toBe(windowPolicy.run.hardMaxModelCalls);
    expect(budget.hardMaxModelCalls).toBe(windowPolicy.run.hardMaxModelCalls);
  });
});

describe("window policy runtime helpers", () => {
  it("calculates a positive loop input budget", () => {
    const windowPolicy = deriveWindowPolicy({
      schemaVersion: WINDOW_BUDGET_SCHEMA_VERSION,
      contextWindowTokens: 30_000,
    });
    const tokens = calculateLoopInputBudgetTokens({
      request: { messages: [], tools: [] } as never,
      windowPolicy,
      estimator: { estimate: () => 100 },
    });
    expect(tokens).toBeGreaterThan(0);
  });

  it("maps usage snapshots and exploration signals", () => {
    const usage = toRunUsage({
      modelCalls: 1,
      toolCalls: 2,
      loopIterations: 3,
      inputTokens: 10,
      outputTokens: 20,
      cacheHitTokens: 0,
      cacheMissTokens: 0,
      fileReadCalls: 50,
      uniqueFilePathsTouched: 2,
    });
    expect(usage.fileReadCalls).toBe(50);

    const reasonCodes: string[] = [];
    const warnings: string[] = [];
    applyExplorationSignal(
      {
        fileReadCalls: 50,
        uniqueFilePathsTouched: 2,
        effectiveFileReadCalls: 50,
      },
      reasonCodes as never,
      warnings,
      {
        explorationRereadMinCalls: 5,
        explorationRereadRatio: 3,
      },
    );
    expect(reasonCodes).toContain("exploration_reread_heavy");
    expect(warnings.length).toBeGreaterThan(0);
  });
});
