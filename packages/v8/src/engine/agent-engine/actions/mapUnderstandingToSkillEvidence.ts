import type { ProjectDescriptor } from "../../../modules/repository-state";
import type { RequestUnderstandingResult } from "../../../modules/request-understanding";
import type { SkillTaskEvidence } from "../../../modules/skills";

import { deriveSkillRepoEvidence } from "./deriveSkillRepoEvidence";

/**
 * Map Request Understanding into the slim Skills evidence slice.
 */
export function mapUnderstandingToSkillEvidence(
  understanding: RequestUnderstandingResult,
  options?: {
    projects?: readonly ProjectDescriptor[];
    extraPaths?: readonly string[];
  },
): SkillTaskEvidence {
  const recommendedSkillTags =
    understanding.intent.classification.taskHints?.recommendedSkillTags ?? [];

  const paths = understanding.taskAnalysis.targets
    .filter((target) => target.kind === "file" || target.kind === "folder")
    .map((target) => normalizeEvidencePath(target.value))
    .filter((path): path is string => Boolean(path));

  const mergedPaths = [
    ...new Set([...(options?.extraPaths ?? []), ...paths]),
  ]
    .filter((path) => path.trim().length > 0)
    .slice(0, 50);

  const repoEvidence = deriveSkillRepoEvidence({
    projects: options?.projects,
    paths: mergedPaths,
  });

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
    paths: mergedPaths,
    recommendedSkillTags: [...recommendedSkillTags],
    languages: repoEvidence.languages,
    projectKinds: repoEvidence.projectKinds,
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
