import { describe, expect, it } from "vitest";

import {
  answerRouteBody,
  clarifyRouteBody,
  diagnoseRouteBody,
  executeRouteBody,
  planRouteBody,
  selectRouteBody,
} from "../../helpers/routes";

describe("route bodies (§6.11)", () => {
  it("clarify never runs tools or verify", () => {
    const b = clarifyRouteBody();
    expect(b.runTurnLoop).toBe(false);
    expect(b.runVerify).toBe(false);
    expect(b.runPlanPipeline).toBe(false);
    expect(b.exit).toBe("suspend_clarify");
    expect(b.grantProfileHint).toBe("none");
  });

  it("answer uses research without plan or verify", () => {
    const b = answerRouteBody();
    expect(b.grantProfileHint).toBe("research");
    expect(b.runPlanPipeline).toBe(false);
    expect(b.runEnrich).toBe(true);
    expect(b.runTurnLoop).toBe(true);
    expect(b.runVerify).toBe(false);
    expect(b.exit).toBe("complete");
  });

  it("diagnose never mutates and does not run 3A", () => {
    const b = diagnoseRouteBody();
    expect(b.grantProfileHint).toBe("research");
    expect(b.runPlanPipeline).toBe(false);
    expect(b.runVerify).toBe(false);
  });

  it("plan always runs 3A and never verify/mutate loop", () => {
    const b = planRouteBody();
    expect(b.runPlanPipeline).toBe(true);
    expect(b.runTurnLoop).toBe(false);
    expect(b.runVerify).toBe(false);
    expect(b.exit).toBe("complete");
  });

  it("execute fast-path skips 3A; visible+gate suspends", () => {
    expect(
      executeRouteBody({ planningDepth: "none", planGate: "none" }),
    ).toMatchObject({
      runPlanPipeline: false,
      runVerify: true,
      exit: "continue_execute",
    });
    expect(
      executeRouteBody({
        planningDepth: "visible",
        planGate: "required_before_execute",
      }),
    ).toMatchObject({
      runPlanPipeline: true,
      exit: "suspend_plan_gate",
    });
  });

  it("selectRouteBody maps wire answer aliases", () => {
    expect(selectRouteBody({ route: "repository_answer" }).route).toBe(
      "answer",
    );
    expect(selectRouteBody({ route: "direct_answer" }).route).toBe("answer");
  });
});
