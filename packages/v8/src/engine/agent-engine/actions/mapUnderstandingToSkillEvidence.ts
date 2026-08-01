import type { RequestUnderstandingResult } from "../../../modules/request-understanding";
import type { SkillTaskEvidence } from "../../../modules/skills";

/**
 * Map Request Understanding into the slim Skills evidence slice.
 */
export function mapUnderstandingToSkillEvidence(
  understanding: RequestUnderstandingResult,
): SkillTaskEvidence {
  return {
    primaryIntent: understanding.intent.classification.primaryTaskIntent,
    secondaryIntents: [
      ...understanding.intent.classification.secondaryTaskIntents,
    ],
    scope: understanding.taskAnalysis.scope,
    complexity: understanding.taskAnalysis.complexity,
    risk: understanding.taskAnalysis.risk,
    recommendsPlanning: understanding.taskAnalysis.recommendsPlanning,
    recommendsVerification: understanding.taskAnalysis.recommendsVerification,
    paths: [],
  };
}
