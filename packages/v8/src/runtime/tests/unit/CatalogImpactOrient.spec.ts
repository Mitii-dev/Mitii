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
              language: "typescript",
              packageManager: "pnpm",
              scripts: { test: "vitest" },
              testRoots: ["packages/demo/tests"],
            },
          ],
          configPointers: ["packages/demo/tsconfig.json"],
        },
        impact: {
          relatedSeeds: ["packages/demo-utils"],
        },
      },
      mode: "agent",
      runId: "cat1",
    });

    const pack = result.store.getSlice<{
      projects?: Array<{ id: string; packageManager?: string }>;
      config?: { pointers: string[] };
      impact?: { relatedSeeds: string[] };
      scope: { relatedSeeds: string[] };
      reasonCodes: string[];
    }>("situationPack");

    expect(pack?.projects?.[0]?.id).toBe("packages/demo");
    expect(pack?.projects?.[0]?.packageManager).toBe("pnpm");
    expect(pack?.config?.pointers).toContain("packages/demo/tsconfig.json");
    expect(pack?.impact?.relatedSeeds).toContain("packages/demo-utils");
    expect(pack?.scope.relatedSeeds).toContain("packages/demo-utils");
    expect(pack?.reasonCodes).toContain("orient_catalog_slice");
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
