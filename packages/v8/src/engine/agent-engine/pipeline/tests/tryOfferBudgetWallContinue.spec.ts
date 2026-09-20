import { describe, expect, it } from "vitest";

import { createDecision, createReadOnlyGrant } from "../../tests/fixtures/stubs";
import { ToolCallCache } from "../../internal/ToolCallCache";
import { tryOfferBudgetWallContinue } from "../tryOfferBudgetWallContinue";

describe("tryOfferBudgetWallContinue", () => {
  it("returns continue_required when overrides remain", () => {
    const outcome = tryOfferBudgetWallContinue({
      wallReason: "unfulfilled_execute",
      messages: [],
      toolCache: new ToolCallCache(),
      changedFiles: [],
      mutationCheckpointIds: [],
      answer: "still diagnosing",
      decision: createDecision({
        route: "execute",
        toolGrant: createReadOnlyGrant({ maximumWorkspaceEffect: "write" }),
        reasonCodes: ["mutation_execute"],
      }),
      continueOverrideCount: 0,
      maxContinueOverrides: 2,
      mutationRequired: true,
    });

    expect(outcome?.kind).toBe("continue_required");
    expect(outcome?.wallReason).toBe("unfulfilled_execute");
    expect(outcome?.rationale).toContain("workspace edit");
    expect(outcome?.rationale).not.toContain("more research");
  });

  it("returns undefined when override cap is reached", () => {
    const outcome = tryOfferBudgetWallContinue({
      wallReason: "budget_exhausted",
      messages: [],
      toolCache: new ToolCallCache(),
      changedFiles: ["a.ts"],
      mutationCheckpointIds: [],
      answer: "",
      decision: createDecision(),
      continueOverrideCount: 2,
      maxContinueOverrides: 2,
      budgetMessage: "Model call budget exhausted.",
    });

    expect(outcome).toBeUndefined();
  });
});
