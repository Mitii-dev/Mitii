import { describe, expect, it } from "vitest";

import {
  PLANNING_ERROR_CODES,
  PLANNING_REASON_CODES,
  PLANNING_SCHEMA_VERSION,
  PLANNING_STATUSES,
  PlanningError,
  PlanningPipeline,
  planArtifactSchema,
  planningInputSchema,
  planningResultSchema,
  resolvePlanStrategy,
} from "../../index";

function validInput(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: PLANNING_SCHEMA_VERSION,
    query: "Add SSO login without breaking password login",
    mode: "plan",
    route: "plan",
    planningDepth: "visible",
    evidence: {
      primaryIntent: "feature",
      secondaryIntents: [],
      interactionIntent: "plan",
      scope: "package",
      complexity: "complex",
      risk: "high",
      clarity: "partially_clear",
      targets: [{ kind: "folder", value: "src/auth", explicit: true }],
      constraints: ["Keep password login working"],
      requestedOutcomes: ["Add SSO login without breaking password login"],
      recommendsPlanning: true,
      recommendsVerification: true,
      changeImpact: ["code", "config"],
    },
    processHints: [],
    ...overrides,
  };
}

describe("Planning contract: input", () => {
  const pipeline = new PlanningPipeline();

  it("accepts valid input through the public schema", () => {
    expect(planningInputSchema.safeParse(validInput()).success).toBe(true);
  });

  it("rejects wrong schema version and missing query with invalid_input", async () => {
    for (const bad of [
      validInput({ schemaVersion: 42 }),
      validInput({ query: undefined }),
    ]) {
      await expect(pipeline.plan(bad as never)).rejects.toMatchObject({
        name: "PlanningError",
        code: "invalid_input",
      });
    }
  });

  it("throws PlanningError instances at the boundary", async () => {
    await expect(pipeline.plan({} as never)).rejects.toBeInstanceOf(
      PlanningError,
    );
  });

  it("publishes stable error codes", () => {
    expect([...PLANNING_ERROR_CODES]).toEqual([
      "invalid_input",
      "invalid_plan",
      "misconfigured",
    ]);
  });
});

describe("Planning contract: output", () => {
  const pipeline = new PlanningPipeline();

  it("returns a schema-valid result with a registered status and reasons", async () => {
    const result = await pipeline.plan(
      planningInputSchema.parse(validInput()),
    );
    expect(planningResultSchema.parse(result)).toEqual(result);
    expect(PLANNING_STATUSES).toContain(result.status);
    expect(result.schemaVersion).toBe(PLANNING_SCHEMA_VERSION);
    for (const code of result.reasonCodes) {
      expect(PLANNING_REASON_CODES).toContain(code);
    }
    expect(result.reasonCodes).toContain("plan_drafted");
  });

  it("emits a plan artifact whose phases carry steps and success criteria", async () => {
    const result = await pipeline.plan(
      planningInputSchema.parse(validInput()),
    );
    expect(result.plan).toBeDefined();
    expect(planArtifactSchema.parse(result.plan)).toEqual(result.plan);
    expect(result.plan!.phases.length).toBeGreaterThan(0);
    for (const phase of result.plan!.phases) {
      expect(phase.steps.length).toBeGreaterThan(0);
    }
  });

  it("returns no plan and plan_depth_none when planning depth is none", async () => {
    const result = await pipeline.plan(
      planningInputSchema.parse(validInput({ planningDepth: "none" })),
    );
    expect(result.plan).toBeUndefined();
    expect(result.reasonCodes).toContain("plan_depth_none");
  });

  it("resolves a strategy decision without drafting", async () => {
    const resolution = await pipeline.resolveStrategy(
      planningInputSchema.parse(validInput()),
    );
    expect(resolution.decision.schemaVersion).toBe(1);
    expect(typeof resolution.decision.strategy).toBe("string");
    expect(typeof resolvePlanStrategy).toBe("function");
  });
});
