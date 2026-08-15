import type { RequestUnderstandingResult } from "../../../modules/request-understanding";
import type {
  PlanChangeImpact,
  PlanningTaskEvidence,
} from "../../../modules/planning";

const PLAN_CHANGE_IMPACTS: ReadonlySet<string> = new Set([
  "code",
  "config",
  "data",
  "infra",
  "security",
  "ux",
]);

/**
 * Map understanding into the slim evidence slice Planning accepts.
 */
export function mapUnderstandingToPlanningEvidence(
  understanding: RequestUnderstandingResult,
): PlanningTaskEvidence {
  const { intent, taskAnalysis } = understanding;
  const risk =
    taskAnalysis.risk === "low" ||
    taskAnalysis.risk === "medium" ||
    taskAnalysis.risk === "high" ||
    taskAnalysis.risk === "critical"
      ? taskAnalysis.risk
      : "medium";

  return {
    primaryIntent: intent.classification.primaryTaskIntent,
    secondaryIntents: [...intent.classification.secondaryTaskIntents],
    interactionIntent: intent.classification.interactionIntent,
    scope: taskAnalysis.scope,
    complexity: taskAnalysis.complexity,
    risk,
    clarity: taskAnalysis.clarity,
    targets: taskAnalysis.targets.map((target) => ({
      kind: target.kind,
      value: target.value,
      explicit: target.explicit,
    })),
    constraints: [...taskAnalysis.constraints],
    requestedOutcomes: [...taskAnalysis.requestedOutcomes],
    // Either signal means "look before drafting" — strategy rules only see
    // one wide-scope flag, so fold recommendsRepositoryDiscovery into it.
    recommendsPlanning:
      taskAnalysis.recommendsPlanning ||
      taskAnalysis.recommendsRepositoryDiscovery,
    recommendsVerification: taskAnalysis.recommendsVerification,
    changeImpact: inferChangeImpact(
      taskAnalysis,
      intent.classification.primaryTaskIntent,
    ),
  };
}

function inferChangeImpact(
  taskAnalysis: RequestUnderstandingResult["taskAnalysis"],
  primaryIntent: string,
): PlanChangeImpact[] {
  const blob = [
    primaryIntent,
    ...taskAnalysis.requestedOutcomes,
    ...taskAnalysis.constraints,
  ]
    .join(" ")
    .toLowerCase();

  const impacts: PlanChangeImpact[] = ["code"];
  if (/\b(config|env|setting|flag)\b/.test(blob)) impacts.push("config");
  if (/\b(schema|migrat|database|data)\b/.test(blob)) impacts.push("data");
  if (/\b(infra|deploy|kubernetes|terraform)\b/.test(blob)) impacts.push("infra");
  if (/\b(auth|sso|oidc|security|permission)\b/.test(blob)) {
    impacts.push("security");
  }
  if (/\b(ui|ux|frontend|css|layout)\b/.test(blob)) impacts.push("ux");

  return impacts.filter((impact) => PLAN_CHANGE_IMPACTS.has(impact));
}
