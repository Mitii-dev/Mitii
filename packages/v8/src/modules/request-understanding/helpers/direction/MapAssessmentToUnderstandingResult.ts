import type { RequestUnderstandingResult } from "../../contracts/output/RequestUnderstandingResult";
import { requestUnderstandingResultSchema } from "../../contracts/output/RequestUnderstandingResult";
import type { TaskDirectionAssessment } from "../../contracts/output/TaskDirectionAssessment";
import { mapAssessmentToTaskAnalysis } from "./MapAssessmentToTaskAnalysis";

/**
 * Compat shim (S2-RU / S2-MAP): ballot → legacy RequestUnderstandingResult.
 * Intent diagnostics are LLM/assessment-only — no RuleIntent dual scores.
 */
export function mapAssessmentToUnderstandingResult(
  assessment: TaskDirectionAssessment,
): RequestUnderstandingResult {
  const taskAnalysis = mapAssessmentToTaskAnalysis(assessment);
  const clarityNum =
    typeof assessment.clarityConfidence === "number"
      ? assessment.clarityConfidence
      : assessment.clarityConfidence === "high"
        ? 0.85
        : assessment.clarityConfidence === "medium"
          ? 0.65
          : 0.35;
  const needsClarify = assessment.askUserSuggested === true;
  const primaryIntent =
    assessment.primaryTaskIntent === "unclear"
      ? "question"
      : assessment.primaryTaskIntent;

  return requestUnderstandingResultSchema.parse({
    intent: {
      status: needsClarify ? "clarification_required" : "accepted",
      classification: {
        primaryTaskIntent: primaryIntent,
        interactionIntent: assessment.interactionIntent,
        secondaryTaskIntents: assessment.secondaryTaskIntents ?? [],
        confidence: clarityNum,
        alternatives: [],
        needsClarification: needsClarify,
      },
      scores: [
        {
          intent: primaryIntent,
          score: clarityNum,
          ruleScore: 0,
          llmScore: clarityNum,
        },
      ],
      confidenceMargin: needsClarify ? 0.1 : 0.4,
      recommendsClarification: needsClarify,
      clarification: needsClarify
        ? {
            question:
              assessment.clarificationQuestions?.[0]?.question ??
              assessment.userQuestions?.[0] ??
              "What should I focus on?",
            options: [],
            slotKind: "intent",
          }
        : undefined,
      diagnostics: {
        ruleSource: "llm",
        llmPrimaryIntent: primaryIntent,
        llmInteractionIntent: assessment.interactionIntent,
        taskAgreement: true,
        interactionAgreement: true,
        interactionConflict: false,
        agreementBonusApplied: 0,
        disagreementPenaltyApplied: 0,
        minimumConfidence: 0.5,
        minimumMargin: 0.1,
      },
    },
    taskAnalysis,
  });
}
