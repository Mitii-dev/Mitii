import { describe, expect, it } from "vitest";

import { taskListSchema } from "../../../../modules/task-list";
import {
  buildBudgetWallRationale,
  buildBudgetWallResetMessage,
  buildStallContinueRationale,
  buildStallContinueResetMessage,
  shouldOfferBudgetWallContinue,
  shouldOfferStallContinue,
} from "../buildStallContinueRationale";

describe("buildBudgetWallRationale", () => {
  it("summarizes exploration stall progress", () => {
    const taskList = taskListSchema.parse({
      schemaVersion: 1,
      source: "agent",
      title: "Work",
      items: [
        {
          id: "1",
          title: "Wire FormBuilder",
          status: "pending",
        },
      ],
    });
    const rationale = buildBudgetWallRationale({
      reason: "exploration_stall",
      changedFiles: ["src/a.ts", "src/b.ts"],
      taskList,
      fileReadCalls: 24,
      uniqueFilePathsTouched: 6,
    });

    expect(rationale).toContain("2 file(s) changed");
    expect(rationale).toContain("Wire FormBuilder");
    expect(rationale).toContain("24 file reads");
  });

  it("frames unfulfilled execute walls as a redirect choice", () => {
    const rationale = buildBudgetWallRationale({
      reason: "unfulfilled_execute",
      changedFiles: [],
      mutationRequired: true,
    });
    expect(rationale).toContain("more research");
    expect(rationale).toContain("dig a little deeper");
  });

  it("frames budget exhaustion with extend copy", () => {
    const rationale = buildBudgetWallRationale({
      reason: "budget_exhausted",
      changedFiles: ["src/a.ts"],
      budgetMessage: "Model call budget exhausted.",
    });
    expect(rationale).toContain("Model call budget exhausted");
    expect(rationale).toContain("keep going a bit longer");
  });

  it("frames verification repair caps", () => {
    const rationale = buildBudgetWallRationale({
      reason: "verification_repair_capped",
      changedFiles: ["src/a.ts"],
    });
    expect(rationale).toContain("Verification repairs are capped");
    expect(rationale).toContain("another pass at fixing");
  });
});

describe("buildStallContinueRationale", () => {
  it("frames zero-progress mutation stalls as a redirect choice", () => {
    const rationale = buildStallContinueRationale({
      changedFiles: [],
      fileReadCalls: 12,
      uniqueFilePathsTouched: 3,
      mutationRequired: true,
    });

    expect(rationale).toContain("more research");
    expect(rationale).toContain("dig a little deeper");
  });
});

describe("shouldOfferBudgetWallContinue", () => {
  it("offers until override cap", () => {
    expect(shouldOfferBudgetWallContinue({ continueOverrideCount: 0 })).toBe(
      true,
    );
    expect(
      shouldOfferBudgetWallContinue({
        continueOverrideCount: 2,
        maxContinueOverrides: 2,
      }),
    ).toBe(false);
  });
});

describe("shouldOfferStallContinue", () => {
  it("offers continue when files changed", () => {
    expect(
      shouldOfferStallContinue({
        changedFiles: ["src/a.ts"],
        mutationRequired: true,
      }),
    ).toBe(true);
  });

  it("offers continue for unfulfilled execute with no edits", () => {
    expect(
      shouldOfferStallContinue({
        changedFiles: [],
        mutationRequired: true,
      }),
    ).toBe(true);
  });
});

describe("buildBudgetWallResetMessage", () => {
  it("includes user guidance and wall-specific reset", () => {
    const message = buildBudgetWallResetMessage({
      reason: "unfulfilled_execute",
      guidance: "Only touch src/LoginForm.tsx",
      mutationRequired: true,
      changedFiles: [],
    });
    expect(message).toContain("mutation recovery limit");
    expect(message).toContain("User guidance: Only touch src/LoginForm.tsx");
    expect(message).toContain("Prefer apply_patch");
  });

  it("keeps stall wrapper for exploration", () => {
    const message = buildStallContinueResetMessage({
      guidance: "focus on tests",
      mutationRequired: false,
      changedFiles: ["a.ts"],
    });
    expect(message).toContain("exploration stall");
    expect(message).toContain("User guidance: focus on tests");
  });
});
