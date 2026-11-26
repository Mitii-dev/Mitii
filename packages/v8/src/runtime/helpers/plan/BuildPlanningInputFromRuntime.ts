import { PLANNING_SCHEMA_VERSION } from "../../../modules/planning/constants";
import type { PlanningInput } from "../../../modules/planning";
import type { TaskDirectionAssessment } from "../../contracts/assess/TaskDirectionAssessment";
import type { SituationPack } from "../../contracts/orient/SituationPack";
import type { RuntimeDecisionSketch } from "../../flow/steps/5-Decide";

/**
 * Map runtime SituationPack + ballot + decision → PlanningInput (S3A).
 */
export function buildPlanningInputFromRuntime(params: {
  pack?: SituationPack;
  assessment: TaskDirectionAssessment;
  decision: RuntimeDecisionSketch;
  mode: "ask" | "plan" | "agent";
}): PlanningInput {
  const { pack, assessment, decision, mode } = params;
  const query = pack?.request?.text ?? pack?.requestText ?? "";
  const focus = pack?.scope.focusPaths ?? [];

  const route =
    decision.route === "repository_answer" ? "plan" : decision.route;
  const planningRoute =
    route === "plan" || route === "execute" ? route : "plan";

  const clarity =
    assessment.clarityConfidence === "low"
      ? "unclear"
      : assessment.clarityConfidence === "medium"
        ? "partially_clear"
        : "clear";

  return {
    schemaVersion: PLANNING_SCHEMA_VERSION,
    query: query.length > 0 ? query : "plan the requested work",
    mode,
    route: planningRoute,
    planningDepth:
      decision.planningDepth === "visible" ||
      decision.planningDepth === "internal" ||
      decision.planningDepth === "none"
        ? decision.planningDepth
        : "internal",
    evidence: {
      primaryIntent: assessment.primaryTaskIntent,
      secondaryIntents: assessment.secondaryTaskIntents ?? [],
      interactionIntent: assessment.interactionIntent,
      scope: assessment.scope,
      complexity: assessment.difficulty,
      risk: assessment.risk,
      clarity,
      taskSize: assessment.taskBand,
      targets: focus.map((value) => ({
        kind: value.includes(".") ? "file" : "folder",
        value,
        explicit: true,
      })),
      constraints: pack?.request?.intentCues?.constraintSnippets ?? [],
      requestedOutcomes: [],
      recommendsPlanning: assessment.planningHint !== "none",
      recommendsVerification: assessment.interactionIntent === "act",
      changeImpact: [],
    },
    knownPathHints: focus.slice(0, 16),
    skills: (pack?.pins?.skillIds ?? []).map((id) => ({ id })),
  };
}
