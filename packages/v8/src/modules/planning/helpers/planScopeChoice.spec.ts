import { describe, expect, it } from "vitest";

import {
  collectCompletedPlanScopeIds,
  hasResolvedPlanScopeChoice,
  resolvePlanScopeId,
} from "./planScopeChoice";

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

describe("resolvePlanScopeId", () => {
  it("maps option ids to a/b/c", () => {
    expect(
      resolvePlanScopeId({ optionId: "outcome:scope-a-focused" }),
    ).toBe("a");
    expect(
      resolvePlanScopeId({ optionId: "outcome:scope-b-corpus" }),
    ).toBe("b");
    expect(
      resolvePlanScopeId({ optionId: "outcome:scope-c-architecture" }),
    ).toBe("c");
  });

  it("prefers the latest user clarification", () => {
    expect(
      resolvePlanScopeId({
        query: "Improve tests",
        conversation: [
          { role: "user", content: "A + quick wins" },
          { role: "assistant", content: "ok" },
          {
            role: "user",
            content:
              "Clarification: B) Corpus-wide quality bar — Raise the bar",
          },
        ],
      }),
    ).toBe("b");
  });
});

describe("collectCompletedPlanScopeIds", () => {
  it("includes current and prior picks in campaign order", () => {
    expect(
      collectCompletedPlanScopeIds({
        currentScopeId: "b",
        conversation: [
          {
            role: "user",
            content:
              "Clarification: A) Focused case hardening — Harden high-value cases",
          },
        ],
      }),
    ).toEqual(["a", "b"]);
  });
});
