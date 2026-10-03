import { describe, expect, it } from "vitest";

import {
  isBroadSharedScopeRepair,
  isConcreteLocalizedMutationAsk,
  shouldRecommendChangeImpact,
} from "../../actions/ClassifySharedScopeRepair";
import { createUnderstanding } from "../fixtures/decisionCases";
import { resolvePlanningDepth } from "../../actions/ResolvePlanningDepth";

describe("shouldRecommendChangeImpact", () => {
  it("recommends shared type/interface edits even when single_location", () => {
    const understanding = createUnderstanding({
      primaryTaskIntent: "bugfix",
      taskAnalysis: {
        scope: "single_location",
        complexity: "simple",
        risk: "low",
      },
    });

    expect(
      shouldRecommendChangeImpact({
        route: "execute",
        primaryTaskIntent: "bugfix",
        taskAnalysis: understanding.taskAnalysis,
        message: "Change the UserProfile interface to make email optional",
      }),
    ).toBe(true);
  });

  it("recommends typecheck fan-out bugfixes", () => {
    const understanding = createUnderstanding({
      primaryTaskIntent: "bugfix",
      taskAnalysis: {
        scope: "single_location",
        complexity: "simple",
        risk: "low",
      },
    });

    expect(
      shouldRecommendChangeImpact({
        route: "execute",
        primaryTaskIntent: "bugfix",
        taskAnalysis: understanding.taskAnalysis,
        message: "Fix the TypeScript compile errors in src/auth.ts",
      }),
    ).toBe(true);
  });

  it("recommends blast-radius analysis on diagnose", () => {
    const understanding = createUnderstanding({
      primaryTaskIntent: "diagnose",
      taskAnalysis: {
        scope: "single_location",
        complexity: "simple",
        risk: "low",
      },
    });

    expect(
      shouldRecommendChangeImpact({
        route: "diagnose",
        primaryTaskIntent: "diagnose",
        taskAnalysis: understanding.taskAnalysis,
        message: "Who depends on validateJwt?",
      }),
    ).toBe(true);
  });

  it("recommends explicit symbol targets", () => {
    const understanding = createUnderstanding({
      primaryTaskIntent: "bugfix",
      taskAnalysis: {
        scope: "single_location",
        complexity: "simple",
        risk: "low",
        targets: [
          {
            kind: "symbol",
            value: "AuthToken",
            explicit: true,
          },
        ],
      },
    });

    expect(
      shouldRecommendChangeImpact({
        route: "execute",
        primaryTaskIntent: "bugfix",
        taskAnalysis: understanding.taskAnalysis,
        message: "Update AuthToken",
      }),
    ).toBe(true);
  });

  it("does not recommend localized typo fixes without shared signals", () => {
    const understanding = createUnderstanding({
      primaryTaskIntent: "bugfix",
      taskAnalysis: {
        scope: "single_location",
        complexity: "simple",
        risk: "low",
      },
    });

    expect(
      shouldRecommendChangeImpact({
        route: "execute",
        primaryTaskIntent: "bugfix",
        taskAnalysis: understanding.taskAnalysis,
        message: "Null pointer in parseConfig — fix it.",
      }),
    ).toBe(false);
  });

  it("does not recommend on clarify / direct_answer", () => {
    const understanding = createUnderstanding({
      primaryTaskIntent: "refactor",
      taskAnalysis: { scope: "package", complexity: "moderate", risk: "low" },
    });

    expect(
      shouldRecommendChangeImpact({
        route: "clarify",
        primaryTaskIntent: "refactor",
        taskAnalysis: understanding.taskAnalysis,
        message: "Refactor the schema",
      }),
    ).toBe(false);
  });

  it("still treats package-wide repair as broad shared scope", () => {
    expect(
      isBroadSharedScopeRepair({
        primaryTaskIntent: "bugfix",
        taskAnalysis: createUnderstanding({
          primaryTaskIntent: "bugfix",
          taskAnalysis: {
            scope: "package",
            complexity: "moderate",
            risk: "low",
          },
        }).taskAnalysis,
        message: "Resolve all TypeScript errors in the package",
      }),
    ).toBe(true);
  });

  it("does not treat small clear UI bug + package pin as broad repair", () => {
    const taskAnalysis = createUnderstanding({
      primaryTaskIntent: "bugfix",
      taskAnalysis: {
        scope: "package",
        complexity: "trivial",
        risk: "low",
        clarity: "clear",
        taskSize: "small",
        planningHint: "short",
        targets: [
          { kind: "folder", value: "apps/desktop", explicit: true },
        ],
      },
    }).taskAnalysis;

    expect(
      isBroadSharedScopeRepair({
        primaryTaskIntent: "bugfix",
        taskAnalysis,
        message:
          "upon clicking Index settings its should redirect properly to semantic tab",
      }),
    ).toBe(false);

    expect(
      shouldRecommendChangeImpact({
        route: "execute",
        primaryTaskIntent: "bugfix",
        taskAnalysis,
        message:
          "upon clicking Index settings its should redirect properly to semantic tab",
      }),
    ).toBe(false);
  });
});

describe("resolvePlanningDepth change-impact recommend", () => {
  it("flags change_impact_recommended for interface edits without visible plan", () => {
    const understanding = createUnderstanding({
      primaryTaskIntent: "bugfix",
      taskAnalysis: {
        scope: "single_location",
        complexity: "simple",
        risk: "low",
      },
    });

    const result = resolvePlanningDepth({
      mode: "agent",
      route: "execute",
      understanding,
      message: "Update the PaymentMethod interface export",
      windowPolicy: {
        planning: { visiblePlanAffordable: true, changeImpactAffordable: true },
      } as never,
    });

    expect(result.planningDepth).toBe("internal");
    expect(result.reasonCodes).toContain("change_impact_recommended");
    expect(result.reasonCodes).toContain("officer_task_size_plan");
  });

  it("flags change_impact_recommended on repository_answer blast-radius asks", () => {
    const understanding = createUnderstanding({
      primaryTaskIntent: "question",
      taskAnalysis: {
        scope: "multi_file",
        complexity: "simple",
        risk: "low",
      },
    });

    const result = resolvePlanningDepth({
      mode: "ask",
      route: "repository_answer",
      understanding,
      message: "What breaks if I rename createSession?",
      windowPolicy: {
        planning: { visiblePlanAffordable: true, changeImpactAffordable: true },
      } as never,
    });

    expect(result.planningDepth).toBe("none");
    expect(result.reasonCodes).toContain("change_impact_recommended");
  });
});

describe("isConcreteLocalizedMutationAsk (Phase 4)", () => {
  it("detects short nav/label change-to asks", () => {
    expect(isConcreteLocalizedMutationAsk("Change the nav label to Docs")).toBe(
      true,
    );
    expect(isConcreteLocalizedMutationAsk("Rename the button to Save")).toBe(
      true,
    );
    expect(isConcreteLocalizedMutationAsk("fix it")).toBe(false);
    expect(isConcreteLocalizedMutationAsk("make it better")).toBe(false);
  });
});
