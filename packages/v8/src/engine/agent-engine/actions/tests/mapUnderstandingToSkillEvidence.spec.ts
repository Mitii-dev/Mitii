import { describe, expect, it } from "vitest";

import { deriveSkillRepoEvidence } from "../deriveSkillRepoEvidence";
import { mapUnderstandingToSkillEvidence } from "../mapUnderstandingToSkillEvidence";
import type { RequestUnderstandingResult } from "../../../../modules/request-understanding";

describe("deriveSkillRepoEvidence", () => {
  it("maps projects and path extensions into soft language/project tags", () => {
    const evidence = deriveSkillRepoEvidence({
      projects: [
        {
          projectId: "api",
          rootPath: "apps/api",
          primaryLanguageId: "python",
          ecosystemId: "poetry",
          manifestPaths: ["apps/api/pyproject.toml"],
        },
      ],
      paths: ["src/main.go", "lib/util.ts"],
    });

    expect(evidence.languages).toEqual(
      expect.arrayContaining(["python", "go", "typescript"]),
    );
    expect(evidence.projectKinds).toEqual(
      expect.arrayContaining(["python", "poetry", "go", "typescript"]),
    );
  });
});

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
        targets: [
          { kind: "file", value: "parse.ts", explicit: true },
        ],
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

    const evidence = mapUnderstandingToSkillEvidence(understanding, {
      projects: [
        {
          projectId: "root",
          rootPath: ".",
          primaryLanguageId: "typescript",
          manifestPaths: [],
        },
      ],
    });

    expect(evidence.primaryIntent).toBe("bugfix");
    expect(evidence.secondaryIntents).toEqual(["diagnose"]);
    expect(evidence.recommendedSkillTags).toEqual(["localize", "null-safety"]);
    expect(evidence.paths).toContain("parse.ts");
    expect(evidence.languages).toContain("typescript");
    expect(evidence.projectKinds).toContain("typescript");
  });
});
