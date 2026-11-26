import { describe, expect, it } from "vitest";

import {
  buildBudgetWallRationale,
  buildBudgetWallResetMessage,
  mapLegacyContinueReason,
  shouldOfferBudgetWallContinue,
  CONTINUE_REASONS,
} from "../../helpers/gates";

describe("§10.3 continue reason trim", () => {
  it("maps legacy budget wall reasons onto trimmed ContinueReason", () => {
    expect(mapLegacyContinueReason("exploration_stall")).toBe(
      "stalled_or_blocked",
    );
    expect(mapLegacyContinueReason("rejected_mutation")).toBe(
      "stalled_or_blocked",
    );
    expect(mapLegacyContinueReason("unfulfilled_execute")).toBe(
      "incomplete_progress",
    );
    expect(mapLegacyContinueReason("incomplete_checklist")).toBe(
      "incomplete_progress",
    );
    expect(mapLegacyContinueReason("budget_exhausted")).toBe(
      "budget_exhausted",
    );
    expect(CONTINUE_REASONS).toHaveLength(6);
  });

  it("builds rationale for trimmed and legacy reasons", () => {
    const trimmed = buildBudgetWallRationale({
      reason: "stalled_or_blocked",
      changedFiles: ["src/a.ts"],
    });
    expect(trimmed).toContain("larger than expected");

    const legacy = buildBudgetWallRationale({
      reason: "exploration_stall",
      changedFiles: [],
      mutationRequired: true,
      fileReadCalls: 12,
      uniqueFilePathsTouched: 4,
    });
    expect(legacy).toContain("first workspace edit");
    expect(legacy).toContain("12 file reads");
  });

  it("builds reset messages for incomplete_progress and evidence_clarify", () => {
    expect(
      buildBudgetWallResetMessage({
        reason: "incomplete_execute",
        mutationRequired: true,
        changedFiles: [],
      }),
    ).toContain("incomplete progress");

    expect(
      buildBudgetWallResetMessage({
        reason: "evidence_clarify",
        mutationRequired: false,
        changedFiles: [],
        guidance: "edit src/auth.ts",
      }),
    ).toContain("User guidance: edit src/auth.ts");
  });

  it("respects continue override budget", () => {
    expect(
      shouldOfferBudgetWallContinue({
        continueOverrideCount: 3,
        maxContinueOverrides: 4,
      }),
    ).toBe(true);
    expect(
      shouldOfferBudgetWallContinue({
        continueOverrideCount: 4,
        maxContinueOverrides: 4,
      }),
    ).toBe(false);
  });
});
