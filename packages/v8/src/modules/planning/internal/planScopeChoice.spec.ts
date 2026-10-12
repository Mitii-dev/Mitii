import { describe, expect, it } from "vitest";

import { hasResolvedPlanScopeChoice } from "./planScopeChoice";

describe("hasResolvedPlanScopeChoice", () => {
  it("detects outcome:scope-* option ids", () => {
    expect(
      hasResolvedPlanScopeChoice({
        optionId: "outcome:scope-c-architecture",
      }),
    ).toBe(true);
    expect(
      hasResolvedPlanScopeChoice({ optionId: "outcome:delivery-quick-wins" }),
    ).toBe(false);
  });

  it("detects Clarification lines appended on resume", () => {
    expect(
      hasResolvedPlanScopeChoice({
        query:
          "How I can improve the test cases?\n\nClarification: C) Runner / architecture changes — Redesign grading DSL",
      }),
    ).toBe(true);
  });

  it("detects free-text B + quality gate", () => {
    expect(
      hasResolvedPlanScopeChoice({
        query: "Improve tests",
        conversation: [{ role: "user", content: "B + quality gate" }],
      }),
    ).toBe(true);
  });

  it("is false for the bare vague ask", () => {
    expect(
      hasResolvedPlanScopeChoice({
        query:
          "How I can improve the test cases? Can you plan or changing the architecture?",
      }),
    ).toBe(false);
  });
});
