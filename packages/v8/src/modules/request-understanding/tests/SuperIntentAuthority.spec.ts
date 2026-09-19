import { describe, expect, it } from "vitest";
import { SuperIntent } from "../intent/resolution/SuperIntent";
import { INTENT_CONSTANTS } from "../intent/constants";
import type { IntentClassification } from "../intent/schema";

function classification(
  overrides: Partial<IntentClassification> &
    Pick<IntentClassification, "interactionIntent" | "primaryTaskIntent">,
): IntentClassification {
  return {
    secondaryTaskIntents: [],
    confidence: 0.9,
    alternatives: [],
    needsClarification: false,
    reason: "test",
    ...overrides,
  };
}

describe("SuperIntent 70% LLM authority", () => {
  const resolver = new SuperIntent();

  it("grows confidence when rule and LLM agree on task + interaction", () => {
    const result = resolver.resolve({
      mode: "agent",
      ruleResult: {
        source: "heuristic_rule",
        classification: classification({
          interactionIntent: "act",
          primaryTaskIntent: "style",
          confidence: 0.8,
        }),
      },
      llmResult: {
        source: "llm",
        classification: classification({
          interactionIntent: "act",
          primaryTaskIntent: "style",
          confidence: 0.8,
        }),
      },
    });

    expect(result.classification.primaryTaskIntent).toBe("style");
    expect(result.classification.interactionIntent).toBe("act");
    expect(result.diagnostics.taskAgreement).toBe(true);
    expect(result.diagnostics.agreementBonusApplied).toBeGreaterThan(0);
    // Blend 0.8 + full agreement bonus (0.08) + half extra (0.04) = 0.92
    expect(result.classification.confidence).toBeGreaterThan(0.8);
    expect(result.status).toBe("accepted");
  });

  it("trusts LLM act over rule question at ≥70% confidence", () => {
    const result = resolver.resolve({
      mode: "agent",
      ruleResult: {
        source: "heuristic_rule",
        classification: classification({
          interactionIntent: "question",
          primaryTaskIntent: "question",
          confidence: 0.85,
        }),
      },
      llmResult: {
        source: "llm",
        classification: classification({
          interactionIntent: "act",
          primaryTaskIntent: "style",
          confidence: 0.72,
          needsClarification: false,
        }),
      },
    });

    expect(result.classification.interactionIntent).toBe("act");
    expect(result.classification.primaryTaskIntent).toBe("style");
    expect(result.diagnostics.interactionConflict).toBe(false);
    expect(result.diagnostics.disagreementPenaltyApplied).toBe(0);
    expect(result.status).toBe("accepted");
  });

  it("does not let sub-70% LLM act override rule question without clarify", () => {
    const result = resolver.resolve({
      mode: "agent",
      ruleResult: {
        source: "heuristic_rule",
        classification: classification({
          interactionIntent: "question",
          primaryTaskIntent: "question",
          confidence: 0.85,
        }),
      },
      llmResult: {
        source: "llm",
        classification: classification({
          interactionIntent: "act",
          primaryTaskIntent: "style",
          confidence: 0.55,
          needsClarification: false,
        }),
      },
    });

    expect(result.classification.interactionIntent).toBe("question");
    expect(result.diagnostics.interactionConflict).toBe(true);
    expect(result.recommendsClarification).toBe(true);
    expect(result.status).toBe("clarification_required");
  });

  it("still clarifies when LLM ≥70% but needsClarification is true", () => {
    const result = resolver.resolve({
      mode: "agent",
      ruleResult: {
        source: "heuristic_rule",
        classification: classification({
          interactionIntent: "question",
          primaryTaskIntent: "question",
          confidence: 0.6,
        }),
      },
      llmResult: {
        source: "llm",
        classification: classification({
          interactionIntent: "act",
          primaryTaskIntent: "style",
          confidence: INTENT_CONSTANTS.HIGH_CONFIDENCE,
          needsClarification: true,
          reason: "Ambiguous target element.",
        }),
      },
    });

    expect(result.classification.interactionIntent).toBe("act");
    expect(result.classification.primaryTaskIntent).toBe("style");
    expect(result.recommendsClarification).toBe(true);
    expect(result.status).toBe("clarification_required");
  });
});
