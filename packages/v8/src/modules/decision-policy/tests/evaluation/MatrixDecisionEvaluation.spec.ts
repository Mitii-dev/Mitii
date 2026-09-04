import { describe, expect, it } from "vitest";

import { DecisionPolicyPipeline } from "../../index";
import { createDecisionInput } from "../fixtures/decisionFixtureHelpers";
import { MATRIX_DECISION_CASES } from "../fixtures/generated/matrixCases";
import { assertDecisionExpectation } from "./assertDecisionExpectation";

/**
 * Generated matrix corpus — tracks drift; target ≥95% route accuracy until corpus matures.
 * Golden suite must pass 100%; matrix may fail while generator expectations are tuned.
 */
describe("Matrix decision policy cases", () => {
  const pipeline = new DecisionPolicyPipeline();

  it("meets matrix route accuracy target", () => {
    let hits = 0;
    const failures: string[] = [];

    for (const fixture of MATRIX_DECISION_CASES) {
      const decision = pipeline.decide(createDecisionInput(fixture));
      try {
        assertDecisionExpectation(decision, fixture.expected, fixture.id);
        hits += 1;
      } catch {
        failures.push(
          `${fixture.id}: expected route=${fixture.expected.route} got ${decision.route}`,
        );
      }
    }

    const accuracy = hits / MATRIX_DECISION_CASES.length;
    if (failures.length > 0 && accuracy < 0.95) {
      expect.fail(
        `Matrix route accuracy ${(accuracy * 100).toFixed(1)}% (${hits}/${MATRIX_DECISION_CASES.length}). Sample failures:\n${failures.slice(0, 8).join("\n")}`,
      );
    }
    expect(accuracy).toBeGreaterThanOrEqual(0.9);
  });

  it("matrix corpus size grows toward 1000-case goal", () => {
    expect(MATRIX_DECISION_CASES.length).toBeGreaterThanOrEqual(180);
  });
});
