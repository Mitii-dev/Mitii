import { describe, expect, it } from "vitest";

import { assessDirectionWithLlm } from "../../helpers/direction/AssessDirectionWithLlm";

describe("assessDirectionWithLlm", () => {
  it("falls back to deterministic without complete hook", async () => {
    const ballot = await assessDirectionWithLlm({
      schemaVersion: 1,
      userCommand: "fix it",
      mode: "agent",
    });
    expect(ballot.primaryTaskIntent).toBe("unclear");
    expect(ballot.reasonCodes).toContain("assess_direction_deterministic");
  });

  it("parses LLM JSON ballot", async () => {
    const ballot = await assessDirectionWithLlm(
      {
        schemaVersion: 1,
        userCommand: "implement auth middleware",
        mode: "agent",
      },
      async () =>
        JSON.stringify({
          schemaVersion: 1,
          primaryTaskIntent: "feature",
          interactionIntent: "act",
          difficulty: "moderate",
          taskBand: "medium",
          risk: "medium",
          scope: "multi_file",
          planningHint: "medium",
          clarityConfidence: "high",
          askUserSuggested: false,
          filesToRead: ["src/auth.ts"],
          reasonCodes: ["officer"],
        }),
    );
    expect(ballot.primaryTaskIntent).toBe("feature");
    expect(ballot.planningHint).toBe("medium");
    expect(ballot.reasonCodes).toContain("assess_direction_llm");
  });

  it("falls back when LLM returns garbage", async () => {
    const ballot = await assessDirectionWithLlm(
      {
        schemaVersion: 1,
        userCommand: "refactor packages/demo",
        mode: "agent",
      },
      async () => "not-json",
    );
    expect(ballot.reasonCodes).toContain("assess_llm_fallback_deterministic");
    expect(ballot.primaryTaskIntent).toBe("refactor");
  });
});
