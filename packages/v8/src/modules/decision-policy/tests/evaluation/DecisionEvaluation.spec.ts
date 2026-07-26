import { describe, expect, it } from "vitest";

import { DecisionPolicyPipeline } from "../../index";
import {
  createInput,
  DECISION_EVALUATION_CASES,
} from "../fixtures/decisionCases";

/**
 * Labeled daily-task decision dataset (Roadmap §7 Decision / §8 targets).
 * Route accuracy target ≥95%; unnecessary visible-plan rate on simple tasks <10%.
 */
describe("Decision evaluation dataset", () => {
  it("meets route accuracy and unnecessary visible-plan targets", () => {
    const pipeline = new DecisionPolicyPipeline();

    let routeHits = 0;
    let simpleVisiblePlanViolations = 0;
    let simpleCases = 0;

    for (const fixture of DECISION_EVALUATION_CASES) {
      const decision = pipeline.decide(createInput(fixture));

      expect(decision.route, fixture.id).toBe(fixture.expected.route);
      routeHits += 1;

      if (fixture.expected.planningDepth !== undefined) {
        expect(decision.planningDepth, fixture.id).toBe(
          fixture.expected.planningDepth,
        );
      }

      if (fixture.expected.maximumWorkspaceEffect !== undefined) {
        expect(decision.toolGrant.maximumWorkspaceEffect, fixture.id).toBe(
          fixture.expected.maximumWorkspaceEffect,
        );
      }

      if (fixture.expected.runDisposition !== undefined) {
        expect(decision.runDisposition, fixture.id).toBe(
          fixture.expected.runDisposition,
        );
      }

      if (fixture.expected.forbidVisiblePlan) {
        simpleCases += 1;
        if (decision.planningDepth === "visible") {
          simpleVisiblePlanViolations += 1;
        }
      }

      if (fixture.expected.maximumWorkspaceEffect === "read") {
        expect(
          decision.toolGrant.allowedEffects,
          fixture.id,
        ).not.toContain("workspace_write");
      }
    }

    const routeAccuracy = routeHits / DECISION_EVALUATION_CASES.length;
    expect(routeAccuracy).toBeGreaterThanOrEqual(0.95);

    const visiblePlanRate =
      simpleCases === 0 ? 0 : simpleVisiblePlanViolations / simpleCases;
    expect(visiblePlanRate).toBeLessThan(0.1);
  });
});
