import { describe, expect, it } from "vitest";

import { buildFallbackClarifyDraft } from "../../../modules/planning";
import { PLANNING_SCHEMA_VERSION } from "../../../modules/planning";
import { planningInputSchema } from "../../../modules/planning";

import { buildPlanClarifySuspension } from "./buildPlanClarifySuspension";

describe("buildPlanClarifySuspension", () => {
  it("exposes findings answer and outcome chip options", () => {
    const input = planningInputSchema.parse({
      schemaVersion: PLANNING_SCHEMA_VERSION,
      query: "Improve test cases or architecture",
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
        requestedOutcomes: ["Improve tests"],
        recommendsPlanning: true,
        recommendsVerification: true,
        changeImpact: ["code"],
      },
    });
    const draft = buildFallbackClarifyDraft(input);
    const suspension = buildPlanClarifySuspension(draft);
    expect(suspension.answer).toMatch(/Need a scope choice before locking a plan/i);
    expect(suspension.clarificationOptions.length).toBeGreaterThanOrEqual(3);
    expect(
      suspension.clarificationOptions.every((option) =>
        option.id.startsWith("outcome:"),
      ),
    ).toBe(true);
    expect(suspension.clarificationSession.options[0]?.patch.outcomeNote).toBeTruthy();
  });
});
