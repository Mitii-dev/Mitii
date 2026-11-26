import { describe, expect, it } from "vitest";

import { runThroughPlanPipeline } from "../../flow/RunThroughPlanPipeline";
import { runEarlyPipeline } from "../../flow/RunEarlyPipeline";

describe("S2C grant + S3A planning wire", () => {
  it("decide attaches compiled toolGrant from plate", async () => {
    const result = await runEarlyPipeline({
      start: { message: "implement a feature in packages/demo" },
      mode: "agent",
      runId: "grant1",
    });
    expect(result.decision.toolGrant).toBeDefined();
    expect(result.decision.toolGrant.maximumWorkspaceEffect).toBe("write");
    expect(result.decision.reasonCodes).toContain("grant_from_plate");
  });

  it("decide fences toolGrant when only-edit prose present", async () => {
    const result = await runEarlyPipeline({
      start: {
        message: "only edit packages/v8/src/runtime helpers for the bugfix",
      },
      mode: "agent",
      runId: "grant2",
    });
    expect(result.decision.mutationPathScopes?.length).toBeGreaterThan(0);
    expect(result.decision.toolGrant.mutationPathScopes).toEqual(
      result.decision.mutationPathScopes,
    );
    expect(result.decision.reasonCodes).toContain("grant_mutation_fence_applied");
  });

  it("plan pipeline calls PlanningPipeline module", async () => {
    const result = await runThroughPlanPipeline({
      start: { message: "plan a visible SSO migration across auth" },
      mode: "plan",
      runId: "plan1",
    });
    expect(result.planPipeline.ran).toBe(true);
    expect(result.planPipeline.reasonCodes).toContain(
      "plan_pipeline_module_wired",
    );
    expect(result.planPipeline.planningStatus).toBeDefined();
    const artifact = result.store.getSlice<{ title?: string; phases?: unknown[] }>(
      "planArtifact",
    );
    if (result.planPipeline.planningStatus === "ok") {
      expect(artifact?.title || result.planPipeline.planTitle).toBeTruthy();
    }
  });
});
