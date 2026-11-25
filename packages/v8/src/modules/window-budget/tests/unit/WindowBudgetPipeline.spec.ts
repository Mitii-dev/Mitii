import { describe, expect, it } from "vitest";

import {
  WINDOW_BUDGET_SCHEMA_VERSION,
  WINDOW_BUDGET_STAGES,
  WindowBudgetPipeline,
  type ModuleLoggerPort,
} from "../../index";

describe("WindowBudgetPipeline", () => {
  it("derives a policy with ordered stage traces", () => {
    const pipeline = new WindowBudgetPipeline();
    const policy = pipeline.derive({
      schemaVersion: WINDOW_BUDGET_SCHEMA_VERSION,
      contextWindowTokens: 100_000,
    });

    expect(policy.usableInputTokens).toBeGreaterThan(0);
    expect(policy.stages?.map((s) => s.name)).toEqual([
      WINDOW_BUDGET_STAGES.resolvePolicy,
      WINDOW_BUDGET_STAGES.deriveAllocation,
    ]);
  });

  it("emits logger stage events when a logger is injected", () => {
    const stages: string[] = [];
    const log: ModuleLoggerPort = {
      stage(event) {
        stages.push(event.stage);
      },
    };
    new WindowBudgetPipeline({ log }).derive({
      schemaVersion: WINDOW_BUDGET_SCHEMA_VERSION,
      contextWindowTokens: 30_000,
    });
    expect(stages).toEqual([
      WINDOW_BUDGET_STAGES.resolvePolicy,
      WINDOW_BUDGET_STAGES.deriveAllocation,
    ]);
  });
});
