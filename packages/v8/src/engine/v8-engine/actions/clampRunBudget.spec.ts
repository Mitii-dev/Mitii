import { describe, expect, it } from "vitest";

import {
  WINDOW_BUDGET_SCHEMA_VERSION,
  deriveWindowPolicy,
} from "../../../modules/window-budget";
import { agentRunBudgetSchema } from "../contracts";
import { clampRunBudget } from "./windowPolicyRuntime";

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
