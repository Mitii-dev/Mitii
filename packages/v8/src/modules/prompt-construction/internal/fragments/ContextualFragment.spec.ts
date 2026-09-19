import { describe, expect, it } from "vitest";

import { CharacterTokenEstimator } from "../../CharacterTokenEstimator";
import { truncateToTokenBudget } from "../../actions/BuildSystemAndConversation";
import {
  FRAGMENT_POLICY,
  InstructionBlockFragment,
  assembleFragments,
  matchesMarkedFragment,
  renderFragment,
  BaseInstructionsFragment,
} from "./index";

describe("ContextualFragment formulae (Codex discipline)", () => {
  const estimator = new CharacterTokenEstimator();

  it("caps a fragment at absoluteMaxTokens (Codex rule 4)", () => {
    const huge = "x".repeat(FRAGMENT_POLICY.absoluteMaxTokens * 8);
    const fragment = new BaseInstructionsFragment(huge);
    const rendered = renderFragment(
      fragment,
      (text) => estimator.estimate(text),
      (text, budget) => truncateToTokenBudget(text, budget, estimator),
    );
    expect(rendered.tokens).toBeLessThanOrEqual(fragment.maxTokens());
    expect(rendered.truncated).toBe(true);
  });

  it("flags fragments above the 1k review threshold without rejecting them", () => {
    const body = "word ".repeat(2_500);
    const fragment = new InstructionBlockFragment(
      "rule-large",
      "Project rules",
      { id: "rule-large", content: body, priority: 100 },
      "rules",
      "project_rules",
    );
    const assembled = assembleFragments({
      fragments: [new BaseInstructionsFragment("You are Mitii."), fragment],
      estimator,
      budgetTokens: 50_000,
      truncateToBudget: (text, budget) =>
        truncateToTokenBudget(text, budget, estimator),
    });
    expect(assembled.included.some((item) => item.contentKind.includes("rule-large"))).toBe(
      true,
    );
    expect(assembled.reviewFlaggedIds).toContain("rule-large");
  });

  it("omits later fragments when the shared budget is exhausted", () => {
    const assembled = assembleFragments({
      fragments: [
        new BaseInstructionsFragment("core"),
        new InstructionBlockFragment(
          "a",
          "Project rules",
          { id: "a", content: "alpha ".repeat(80), priority: 10 },
          "rules",
          "project_rules",
        ),
        new InstructionBlockFragment(
          "b",
          "Project rules",
          { id: "b", content: "beta ".repeat(80), priority: 1 },
          "rules",
          "project_rules",
        ),
      ],
      estimator,
      budgetTokens: 40,
      truncateToBudget: (text, budget) =>
        truncateToTokenBudget(text, budget, estimator),
    });
    expect(assembled.omissions.length).toBeGreaterThan(0);
    expect(assembled.omissions.every((item) => item.reason === "budget" || item.reason === "empty")).toBe(
      true,
    );
  });

  it("matches marked text only when both start and end markers are present (Codex)", () => {
    expect(matchesMarkedFragment("<a>", "</a>", "  <a>body</a>  ")).toBe(true);
    expect(matchesMarkedFragment("<a>", "</a>", "body</a>")).toBe(false);
    expect(matchesMarkedFragment("", "", "anything")).toBe(false);
  });

  it("applies additional-context 1k soft cap to environment fragments", () => {
    const fragment = new InstructionBlockFragment(
      "env-1",
      "Environment",
      {
        id: "env-1",
        content: "env ".repeat(2_000),
        priority: 100,
      },
      "environment",
      "environment",
    );
    expect(fragment.maxTokens()).toBe(
      FRAGMENT_POLICY.additionalContextValueTokens,
    );
  });

  it("allows instruction fragments up to absoluteMaxTokens (Codex hard cap)", () => {
    const fragment = new InstructionBlockFragment(
      "skill-1",
      "Skills",
      {
        id: "skill-1",
        content: "skill body",
        priority: 100,
      },
      "skills",
      "skills",
    );
    expect(fragment.maxTokens()).toBe(FRAGMENT_POLICY.absoluteMaxTokens);
  });
});
