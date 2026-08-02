import { describe, expect, it } from "vitest";

import type { RequestUnderstandingResult } from "../../../../modules/request-understanding";
import { mapUnderstandingToSkillEvidence } from "../mapUnderstandingToSkillEvidence";

describe("mapUnderstandingToSkillEvidence", () => {
  it("forwards recommendedSkillTags from understanding taskHints", () => {
    const understanding = {
      intent: {
        status: "accepted",
        classification: {
          interactionIntent: "act",
          primaryTaskIntent: "bugfix",
          secondaryTaskIntents: ["diagnose"],
          confidence: 0.9,
          alternatives: [],
          needsClarification: false,
          taskHints: {
            targets: [],
            constraints: [],
            requestedOutcomes: [],
            recommendedSkillTags: ["localize", "null-safety"],
          },
        },
        scores: [],
        confidenceMargin: 0.4,
        recommendsClarification: false,
        diagnostics: {
          llmPrimaryIntent: "bugfix",
          llmInteractionIntent: "act",
          taskAgreement: false,
          interactionAgreement: true,
          interactionConflict: false,
          agreementBonusApplied: 0,
          disagreementPenaltyApplied: 0,
          minimumConfidence: 0.55,
          minimumMargin: 0.12,
        },
      },
      taskAnalysis: {
        scope: "single_location",
        complexity: "simple",
        risk: "low",
        clarity: "clear",
        targets: [],
        constraints: [],
        requestedOutcomes: [],
        recommendsRepositoryDiscovery: false,
        recommendsPlanning: false,
        recommendsVerification: true,
        recommendsTaskClarification: false,
        signals: [],
        confidence: 0.8,
      },
    } as RequestUnderstandingResult;

    const evidence = mapUnderstandingToSkillEvidence(understanding);

    expect(evidence.primaryIntent).toBe("bugfix");
    expect(evidence.secondaryIntents).toEqual(["diagnose"]);
    expect(evidence.recommendedSkillTags).toEqual(["localize", "null-safety"]);
  });
});
