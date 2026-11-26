import type { TaskAnalysis } from "../task-analyzer/contracts/output/TaskAnalysis";
import { TaskAnalysisSchema } from "../task-analyzer/contracts/output/TaskAnalysis";
import type { TaskDirectionAssessment } from "../../contracts/output/TaskDirectionAssessment";

/**
 * Compat shim (S2-MAP): derive legacy TaskAnalysis from ballot for one release.
 * Dual flags: recommendsPlanning follows planningHint ≠ none.
 */
export function mapAssessmentToTaskAnalysis(
  assessment: TaskDirectionAssessment,
  extras?: {
    targets?: TaskAnalysis["targets"];
    constraints?: string[];
  },
): TaskAnalysis {
  const clarity =
    assessment.clarityConfidence === "low"
      ? "unclear"
      : assessment.clarityConfidence === "medium"
        ? "partially_clear"
        : "clear";

  const planningHint = assessment.planningHint;
  const recommendsPlanning = planningHint !== "none";

  return TaskAnalysisSchema.parse({
    scope: assessment.scope,
    complexity: assessment.difficulty,
    risk: assessment.risk,
    clarity,
    targets: extras?.targets ?? [],
    constraints: extras?.constraints ?? [],
    requestedOutcomes: [],
    recommendsRepositoryDiscovery:
      assessment.scope === "repository" ||
      assessment.scope === "workspace" ||
      assessment.scope === "package",
    recommendsPlanning,
    recommendsVerification: assessment.interactionIntent === "act",
    recommendsTaskClarification: assessment.askUserSuggested,
    taskSize: assessment.taskBand,
    planningHint,
    signals: [],
    confidence:
      assessment.clarityConfidence === "high"
        ? 0.85
        : assessment.clarityConfidence === "medium"
          ? 0.65
          : 0.35,
  });
}
