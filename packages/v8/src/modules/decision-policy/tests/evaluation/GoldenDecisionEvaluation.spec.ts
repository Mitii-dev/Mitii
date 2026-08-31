import { describe, expect, it } from "vitest";

import { DecisionPolicyPipeline } from "../../index";
import { GOLDEN_DECISION_CASES, createDecisionInput } from "../fixtures/goldenCases";
import { assertDecisionExpectation } from "./assertDecisionExpectation";

/**
 * Golden decision-policy suite — 100% pass required.
 * Expand toward 80+ cases, then scale generated corpus to 1000.
 */
describe("Golden decision policy cases", () => {
  const pipeline = new DecisionPolicyPipeline();

  for (const fixture of GOLDEN_DECISION_CASES) {
    it(`${fixture.id} (${fixture.category})`, () => {
      const input = createDecisionInput(fixture);
      let decision = pipeline.decide(input);

      if (fixture.adjustment?.kind === "narrow") {
        decision = pipeline.narrow({
          previous: decision,
          discoveredPaths: fixture.adjustment.discoveredPaths,
          residualRisk: fixture.adjustment.residualRisk,
        });
      } else if (fixture.adjustment?.kind === "widen") {
        decision = pipeline.widen({
          previous: decision,
          extraPaths: fixture.adjustment.extraPaths,
        });
      }

      assertDecisionExpectation(decision, fixture.expected, fixture.id);
    });
  }

  it("golden suite has at least 80 cases", () => {
    expect(GOLDEN_DECISION_CASES.length).toBeGreaterThanOrEqual(80);
  });
});
