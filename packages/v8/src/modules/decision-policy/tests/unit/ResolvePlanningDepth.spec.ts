import { describe, expect, it } from "vitest";

import { resolvePlanningDepth } from "../../actions/ResolvePlanningDepth";
import { createUnderstanding } from "../fixtures/decisionCases";

describe("resolvePlanningDepth", () => {
  it("treats full-package feature implementation as visible when affordable", () => {
    const understanding = createUnderstanding({
      primaryTaskIntent: "feature",
      taskAnalysis: {
        scope: "package",
        complexity: "complex",
        risk: "low",
        recommendsPlanning: true,
        estimatedFilesAffected: { minimum: 8, maximum: 20 },
      },
    });

    const result = resolvePlanningDepth({
      mode: "agent",
      route: "execute",
      understanding,
      message: "Implement the entire mui-builder package like formik",
      windowPolicy: {
        planning: { visiblePlanAffordable: true, changeImpactAffordable: true },
      } as never,
    });

    expect(result.planningDepth).toBe("visible");
    expect(result.reasonCodes).toContain("large_implementation_visible_plan");
  });

  it("keeps routine package feature work on internal planning", () => {
    const understanding = createUnderstanding({
      primaryTaskIntent: "feature",
      taskAnalysis: {
        scope: "package",
        complexity: "moderate",
        risk: "low",
        estimatedFilesAffected: { minimum: 2, maximum: 3 },
      },
    });

    const result = resolvePlanningDepth({
      mode: "agent",
      route: "execute",
      understanding,
      message: "Add a small helper to the package",
      windowPolicy: {
        planning: { visiblePlanAffordable: true, changeImpactAffordable: true },
      } as never,
    });

    expect(result.planningDepth).toBe("internal");
    expect(result.reasonCodes).toContain("multi_file_internal_plan");
    expect(result.reasonCodes).not.toContain("large_implementation_visible_plan");
  });

  it("treats project restructure as architecture-scale visible plan", () => {
    const understanding = createUnderstanding({
      primaryTaskIntent: "refactor",
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
      message:
        "Restructure this project and add a proper folder restructure as well",
      windowPolicy: {
        planning: { visiblePlanAffordable: true, changeImpactAffordable: true },
      } as never,
    });

    expect(result.planningDepth).toBe("visible");
    expect(result.reasonCodes).toContain("architecture_visible_plan");
  });

  it("upgrades long execute briefs to an internal plan", () => {
    const understanding = createUnderstanding({
      primaryTaskIntent: "bugfix",
      taskAnalysis: {
        scope: "single_location",
        complexity: "simple",
        risk: "low",
      },
    });
    const message = `Fix Desktop headless.\n\n${"x".repeat(1_300)}`;

    const result = resolvePlanningDepth({
      mode: "agent",
      route: "execute",
      understanding,
      message,
      windowPolicy: {
        contextWindowTokens: 64_000,
        planning: { visiblePlanAffordable: true, changeImpactAffordable: true },
      } as never,
    });

    expect(result.planningDepth).toBe("internal");
    expect(result.reasonCodes).toContain("long_prompt_internal_plan");
  });

  it("does not plan from length alone on repository_answer", () => {
    const understanding = createUnderstanding({
      primaryTaskIntent: "question",
      taskAnalysis: {
        scope: "repository",
        complexity: "simple",
        risk: "low",
      },
    });
    const message = `What is this?\n\n${"x".repeat(3_000)}`;

    const result = resolvePlanningDepth({
      mode: "agent",
      route: "repository_answer",
      understanding,
      message,
      windowPolicy: {
        contextWindowTokens: 64_000,
        planning: { visiblePlanAffordable: true, changeImpactAffordable: true },
      } as never,
    });

    expect(result.planningDepth).toBe("none");
  });

  it("honors Officer medium taskSize with short planningHint as internal", () => {
    const understanding = createUnderstanding({
      primaryTaskIntent: "bugfix",
      taskAnalysis: {
        scope: "single_location",
        complexity: "simple",
        risk: "low",
        taskSize: "medium",
        planningHint: "short",
      },
    });

    const result = resolvePlanningDepth({
      mode: "agent",
      route: "execute",
      understanding,
      message: "Fix the failing tests",
      windowPolicy: {
        planning: { visiblePlanAffordable: true, changeImpactAffordable: true },
      } as never,
    });

    expect(result.planningDepth).toBe("internal");
    expect(result.reasonCodes).toContain("officer_task_size_plan");
  });

  it("honors Officer large taskSize as visible when affordable", () => {
    const understanding = createUnderstanding({
      primaryTaskIntent: "feature",
      taskAnalysis: {
        scope: "multi_file",
        complexity: "moderate",
        risk: "low",
        taskSize: "large",
        planningHint: "long",
      },
    });

    const result = resolvePlanningDepth({
      mode: "agent",
      route: "execute",
      understanding,
      message: "Implement the settings flow",
      windowPolicy: {
        planning: { visiblePlanAffordable: true, changeImpactAffordable: true },
      } as never,
    });

    expect(result.planningDepth).toBe("visible");
    expect(result.reasonCodes).toContain("officer_task_size_plan");
  });

  it("forces at least internal short plan for agent execute small asks", () => {
    const understanding = createUnderstanding({
      primaryTaskIntent: "bugfix",
      taskAnalysis: {
        scope: "single_location",
        complexity: "trivial",
        risk: "low",
        taskSize: "small",
        planningHint: "short",
      },
    });

    const result = resolvePlanningDepth({
      mode: "agent",
      route: "execute",
      understanding,
      message:
        "upon clicking Index settings its should redirect properly to semantic tab",
      windowPolicy: {
        planning: { visiblePlanAffordable: true, changeImpactAffordable: true },
      } as never,
    });

    expect(result.planningDepth).toBe("internal");
    expect(result.reasonCodes).toContain("officer_task_size_plan");
    expect(result.reasonCodes).not.toContain("simple_localized_no_visible_plan");
  });
});
