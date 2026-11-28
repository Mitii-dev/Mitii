import { describe, expect, it } from "vitest";

import { runEarlyPipeline } from "../../flow/RunEarlyPipeline";

describe("orient catalog + impact", () => {
  it("loads catalog projects and impact seeds into SituationPack", async () => {
    const result = await runEarlyPipeline({
      start: {
        message: "fix packages/demo tests",
        catalog: {
          projects: [
            {
              id: "packages/demo",
              name: "@acme/demo",
              language: "typescript",
              packageManager: "pnpm",
              scripts: { test: "vitest" },
              testRoots: ["packages/demo/tests"],
            },
            {
              id: "packages/demo-utils",
              name: "@acme/demo-utils",
              language: "typescript",
            },
          ],
          configPointers: [
            "package.json",
            "packages/demo/tsconfig.json",
            "turbo.json",
          ],
          relationships: [
            {
              fromProjectId: "packages/demo",
              toProjectId: "packages/demo-utils",
              type: "depends_on",
            },
          ],
        },
        impact: {
          relatedSeeds: ["packages/extra"],
        },
      },
      mode: "agent",
      runId: "cat1",
    });

    const pack = result.store.getSlice<{
      projects?: Array<{ id: string; packageManager?: string }>;
      relationships?: Array<{ toProjectId: string }>;
      config?: { pointers: string[] };
      navigation?: { surroundings: string[] };
      impact?: { relatedSeeds: string[] };
      scope: { relatedSeeds: string[]; workRoot?: string };
      reasonCodes: string[];
    }>("situationPack");

    expect(pack?.projects?.[0]?.id).toBe("packages/demo");
    expect(pack?.projects?.[0]?.packageManager).toBe("pnpm");
    expect(pack?.config?.pointers?.[0]).toBe("packages/demo/tsconfig.json");
    expect(pack?.relationships?.[0]?.toProjectId).toBe("packages/demo-utils");
    expect(pack?.impact?.relatedSeeds).toEqual(
      expect.arrayContaining(["packages/extra", "packages/demo-utils"]),
    );
    expect(pack?.scope.relatedSeeds).toEqual(
      expect.arrayContaining(["packages/extra", "packages/demo-utils"]),
    );
    expect(pack?.scope.workRoot).toBe("packages/demo");
    expect(pack?.navigation?.surroundings).toEqual(
      expect.arrayContaining(["packages/demo", "packages/demo-utils"]),
    );
    expect(pack?.reasonCodes).toContain("orient_catalog_slice");
    expect(pack?.reasonCodes).toContain("orient_catalog_relationships");
    expect(pack?.reasonCodes).toContain("orient_related_projects");
    expect(pack?.reasonCodes).toContain("orient_surroundings");
    expect(pack?.reasonCodes).toContain("orient_config_near_focus");
    expect(pack?.reasonCodes).toContain("orient_impact_seeds");
  });

  it("uses model port for LLM assess when injected", async () => {
    const result = await runEarlyPipeline({
      start: { message: "implement feature X" },
      mode: "agent",
      runId: "llm1",
      deps: {
        model: {
          complete: async () => ({
            text: JSON.stringify({
              schemaVersion: 1,
              primaryTaskIntent: "feature",
              interactionIntent: "act",
              difficulty: "simple",
              taskBand: "small",
              risk: "low",
              scope: "single_location",
              planningHint: "short",
              clarityConfidence: "high",
              askUserSuggested: false,
              filesToRead: [],
              reasonCodes: [],
            }),
            toolCalls: [],
            reasonCodes: [],
          }),
        },
      },
    });
    const assessment = result.store.getSlice<{
      reasonCodes: string[];
      primaryTaskIntent: string;
    }>("assessment");
    expect(assessment?.reasonCodes).toContain("assess_direction_llm");
    expect(assessment?.primaryTaskIntent).toBe("feature");
  });
});
