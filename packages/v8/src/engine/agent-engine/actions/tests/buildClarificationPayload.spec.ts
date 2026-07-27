import { describe, expect, it } from "vitest";

import {
  amendMessageWithClarification,
  buildClarificationPayload,
} from "../buildClarificationPayload";
import type { RequestUnderstandingResult } from "../../../../modules/request-understanding";
import {
  MITII_HOST_CONTEXT_MARKER,
  MITII_USER_MESSAGE_MARKER,
} from "../../../../modules/request-understanding/intent/extractPrimaryUserMessage";

function baseUnderstanding(
  overrides: Partial<RequestUnderstandingResult> = {},
): RequestUnderstandingResult {
  return {
    intent: {
      status: "clarification_required",
      classification: {
        interactionIntent: "act",
        primaryTaskIntent: "implement_feature",
        secondaryTaskIntents: [],
        confidence: 0.4,
        alternatives: [
          { intent: "explain_code", confidence: 0.35 },
          { intent: "refactor_code", confidence: 0.3 },
        ],
        needsClarification: true,
      },
      scores: [],
      confidenceMargin: 0.05,
      recommendsClarification: true,
      clarification: {
        question: "What outcome do you want from this request?",
        options: [
          {
            intent: "implement_feature",
            label: "Implement Feature",
            description: "Make a code change",
            confidence: 0.4,
          },
          {
            intent: "explain_code",
            label: "Explain Code",
            description: "Read-only explanation",
            confidence: 0.35,
          },
        ],
      },
      diagnostics: {
        llmPrimaryIntent: "implement_feature",
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
      scope: "file",
      complexity: "moderate",
      risk: "low",
      clarity: "unclear",
      targets: [],
      constraints: [],
      requestedOutcomes: [],
      recommendsRepositoryDiscovery: true,
      recommendsPlanning: false,
      recommendsVerification: false,
      recommendsTaskClarification: true,
      estimatedFilesAffected: { minimum: 1 },
      signals: [
        {
          type: "clarity",
          value: "unclear",
          weight: 0.9,
          evidence:
            "The request contains an unresolved reference without artifact or target metadata.",
        },
      ],
      confidence: 0.4,
    },
    ...overrides,
  } as RequestUnderstandingResult;
}

describe("buildClarificationPayload", () => {
  it("uses intent clarification options and never the host prompt", () => {
    const payload = buildClarificationPayload(baseUnderstanding());
    expect(payload.clarificationPrompt).toBe(
      "What outcome do you want from this request?",
    );
    expect(payload.clarificationOptions).toHaveLength(2);
    expect(payload.clarificationOptions[0]?.label).toBe("Implement Feature");
  });

  it("falls back to clarity evidence when options are missing", () => {
    const understanding = baseUnderstanding();
    understanding.intent.clarification = undefined;
    understanding.intent.classification.alternatives = [];
    const payload = buildClarificationPayload(
      understanding,
      "mode=agent; route=clarify; reasons=clarification_material",
    );
    expect(payload.clarificationPrompt).toContain("unresolved reference");
    expect(payload.clarificationPrompt).not.toMatch(/^mode=/);
  });
});

describe("amendMessageWithClarification", () => {
  it("amends the primary ask while preserving host context markers", () => {
    const composed = [
      `${MITII_USER_MESSAGE_MARKER}`,
      "Write architecture of this file to md",
      "",
      `${MITII_HOST_CONTEXT_MARKER}`,
      "Workspace file map (3 files):",
      "- a.ts",
    ].join("\n");

    const amended = amendMessageWithClarification(
      composed,
      "Use README.md and cover the Desktop POM",
    );

    expect(amended).toContain("Clarification: Use README.md");
    expect(amended).toContain(MITII_HOST_CONTEXT_MARKER);
    expect(amended).toContain("Workspace file map");
    expect(amended.indexOf("Clarification:")).toBeLessThan(
      amended.indexOf(MITII_HOST_CONTEXT_MARKER),
    );
  });
});
