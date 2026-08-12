import type { RequestUnderstandingResult } from "../../../modules/request-understanding";
import type { SkillTaskEvidence } from "../../../modules/skills";

/**
 * Map Request Understanding into the slim Skills evidence slice.
 */
export function mapUnderstandingToSkillEvidence(
  understanding: RequestUnderstandingResult,
): SkillTaskEvidence {
  const recommendedSkillTags =
    understanding.intent.classification.taskHints?.recommendedSkillTags ?? [];

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
    paths: understanding.taskAnalysis.targets
      .filter((target) => target.kind === "file" || target.kind === "folder")
      .map((target) => normalizeEvidencePath(target.value))
      .filter((path): path is string => Boolean(path))
      .slice(0, 50),
    recommendedSkillTags: [...recommendedSkillTags],
    languages: [],
    projectKinds: [],
  };
}

function normalizeEvidencePath(value: string): string | undefined {
  const normalized = value
    .trim()
    .replace(/^@+/, "")
    .replace(/\\/g, "/")
    .replace(/^\.\//, "");
  return normalized.length > 0 ? normalized : undefined;
}
