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
});
