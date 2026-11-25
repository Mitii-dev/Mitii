import { describe, expect, it } from "vitest";

import {
  extractExplicitFilePaths,
  FAST_PATH_DECLINE_REASONS,
  resolveFastPath,
} from "../../helpers/ResolveFastPath";
import { resolvePlanningDepth } from "../../helpers/ResolvePlanningDepth";
import { executionDecisionSchema } from "../../contracts";
import { createUnderstanding } from "../fixtures/decisionCases";

const WINDOW = {
  planning: { visiblePlanAffordable: true, changeImpactAffordable: true },
} as never;

type TaskAnalysisOverrides = NonNullable<
  NonNullable<Parameters<typeof createUnderstanding>[0]>["taskAnalysis"]
>;

function smallUnderstanding(taskAnalysis: TaskAnalysisOverrides = {}) {
  return createUnderstanding({
    primaryTaskIntent: "bugfix",
    taskAnalysis: {
      scope: "single_location",
      complexity: "simple",
      risk: "low",
      clarity: "clear",
      taskSize: "small",
      planningHint: "short",
      recommendsPlanning: false,
      ...taskAnalysis,
    },
  });
}

describe("extractExplicitFilePaths", () => {
  it("returns concrete file paths and ignores urls / prose tokens", () => {
    const paths = extractExplicitFilePaths(
      "Update `src/auth/login.ts` and README.md, see https://example.com/a.html (e.g. node.js).",
    );
    expect(paths).toEqual(["src/auth/login.ts", "README.md"]);
  });

  it("accepts sentence-final punctuation after a path", () => {
    expect(extractExplicitFilePaths("Fix src/a.ts.")).toEqual(["src/a.ts"]);
  });

  it("does not treat bare versions or numbers as paths", () => {
    expect(extractExplicitFilePaths("Bump to 1.2.3 and 4.5")).toEqual([]);
  });
});

describe("resolveFastPath", () => {
  const base = {
    mode: "agent" as const,
    route: "execute",
    message: "Change the greeting in src/hello.ts to say hi.",
  };

  it("is eligible for a small agent execute ask with explicit paths", () => {
    const result = resolveFastPath({
      ...base,
      understanding: smallUnderstanding(),
    });
    expect(result).toEqual({ eligible: true, paths: ["src/hello.ts"] });
  });

  it("uses explicit file targets from understanding", () => {
    const result = resolveFastPath({
      ...base,
      message: "Make the greeting friendlier.",
      understanding: smallUnderstanding({
        targets: [{ kind: "file", value: "src/hello.ts", explicit: true }],
      }),
    });
    expect(result.eligible).toBe(true);
  });

  it.each([
    ["not_agent_execute", { mode: "plan" as const }, {}],
    ["no_explicit_file_paths", { message: "Fix the greeting." }, {}],
    [
      "too_many_explicit_paths",
      { message: "Edit a/one.ts b/two.ts c/three.ts d/four.ts" },
      {},
    ],
    ["officer_plan_signal", {}, { taskSize: "medium" as const }],
    ["officer_plan_signal", {}, { recommendsPlanning: true }],
    ["not_small_complexity", {}, { complexity: "moderate" as const }],
    ["elevated_risk", {}, { risk: "high" as const }],
    ["unclear_ask", {}, { clarity: "unclear" as const }],
    ["wide_scope", {}, { scope: "package" as const }],
    [
      "wide_scope",
      {},
      { estimatedFilesAffected: { minimum: 4, maximum: 9 } },
    ],
    [
      "prompt_too_long",
      { message: `Fix src/hello.ts. ${"x".repeat(800)}` },
      {},
    ],
    [
      "broad_or_multi_outcome",
      { message: "Fix all failing tests in src/hello.ts across the package" },
      {},
    ],
  ])("declines with %s", (reason, overrides, analysis) => {
    const result = resolveFastPath({
      ...base,
      ...overrides,
      understanding: smallUnderstanding(analysis),
    });
    expect(result.eligible).toBe(false);
    if (!result.eligible) {
      expect(result.reason).toBe(reason);
      expect(FAST_PATH_DECLINE_REASONS).toContain(result.reason);
    }
  });

  it("declines shared-surface intents and change-impact recommendations", () => {
    const refactor = createUnderstanding({
      primaryTaskIntent: "refactor",
      taskAnalysis: {
        scope: "single_location",
        complexity: "simple",
        risk: "low",
        clarity: "clear",
      },
    });
    const shared = resolveFastPath({ ...base, understanding: refactor });
    expect(shared).toMatchObject({
      eligible: false,
      reason: "shared_surface_intent",
    });

    const impact = resolveFastPath({
      ...base,
      understanding: smallUnderstanding(),
      changeImpactRecommended: true,
    });
    expect(impact).toMatchObject({
      eligible: false,
      reason: "change_impact_recommended",
    });
  });
});

describe("resolvePlanningDepth fast path", () => {
  it("skips plan + discovery with a stable reason code", () => {
    const result = resolvePlanningDepth({
      mode: "agent",
      route: "execute",
      understanding: smallUnderstanding(),
      message: "Change the greeting in src/hello.ts to say hi.",
      windowPolicy: WINDOW,
    });
    expect(result.planningDepth).toBe("none");
    expect(result.reasonCodes).toContain("fast_path_explicit_paths");
    expect(result.reasonCodes).not.toContain("multi_file_internal_plan");
    expect(
      executionDecisionSchema.shape.reasonCodes.safeParse(result.reasonCodes)
        .success,
    ).toBe(true);
  });

  it("keeps the internal plan for pathless small asks", () => {
    const result = resolvePlanningDepth({
      mode: "agent",
      route: "execute",
      understanding: smallUnderstanding(),
      message: "Change the greeting to say hi.",
      windowPolicy: WINDOW,
    });
    expect(result.planningDepth).toBe("internal");
    expect(result.reasonCodes).not.toContain("fast_path_explicit_paths");
  });

  it("does not downgrade Officer medium asks that name a file", () => {
    const result = resolvePlanningDepth({
      mode: "agent",
      route: "execute",
      understanding: smallUnderstanding({ taskSize: "medium" }),
      message: "Rework the greeting flow in src/hello.ts.",
      windowPolicy: WINDOW,
    });
    expect(result.planningDepth).toBe("internal");
    expect(result.reasonCodes).not.toContain("fast_path_explicit_paths");
  });
});
