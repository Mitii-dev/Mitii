import { describe, expect, it } from "vitest";

import { buildFallbackClarifyDraft } from "./DraftClarifyFromDiscovery";
import { formatClarifyAsAnswer } from "./formatClarifyAsAnswer";
import { PLANNING_SCHEMA_VERSION } from "../constants";
import { planningInputSchema } from "../contracts";

describe("formatClarifyAsAnswer", () => {
  it("keeps clarify answer short: findings + A/B/C labels only", () => {
    const input = planningInputSchema.parse({
      schemaVersion: PLANNING_SCHEMA_VERSION,
      query: "How I can improve the test cases? Can you plan or changing the architecture?",
      mode: "plan",
      route: "plan",
      planningDepth: "visible",
      evidence: {
        primaryIntent: "refactor",
        secondaryIntents: [],
        interactionIntent: "plan",
        scope: "repository",
        complexity: "complex",
        risk: "medium",
        clarity: "unclear",
        targets: [],
        constraints: [],
        requestedOutcomes: ["Improve test cases or architecture"],
        recommendsPlanning: true,
        recommendsVerification: true,
        changeImpact: ["code"],
        taskSize: "medium",
      },
      discoveryBrief: {
        schemaVersion: 1,
        objective: "Improve test cases",
        filesRead: [
          { path: "docs/GRADING_AND_DRY_RUN.md", reason: "seed" },
          { path: "packages/runner/test/grade-compiler.test.js", reason: "seed" },
        ],
        targets: [],
        proposedChangeSurfaces: [],
        discoveredConstraints: [],
        verificationHints: [],
        openQuestions: [],
        confidence: "low",
      },
    });
    const draft = buildFallbackClarifyDraft(input, input.discoveryBrief);
    const answer = formatClarifyAsAnswer(draft);
    expect(answer).toMatch(/Need a scope choice/i);
    expect(answer).toMatch(/Pick one/i);
    expect(answer).toMatch(/A\)|Focused/i);
    expect(answer).toMatch(/B\)|Corpus/i);
    expect(answer).toMatch(/C\)|architecture/i);
    expect(answer).not.toMatch(/First delivery/i);
    expect(answer).not.toMatch(/Harden high-value cases/i);
    expect(answer).not.toMatch(/smallest coherent change/i);
    expect(answer).not.toMatch(/^Objective:/m);
    expect(answer.length).toBeLessThan(700);
    expect(draft.findings.length).toBeLessThanOrEqual(2);
  });
});
