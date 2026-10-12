import {
  PLANNING_SCHEMA_VERSION,
  mapUnderstandingToPlanningEvidence,
  planningInputSchema,
  type PlanningInput,
  type PlanningParsedInput,
} from "../../../modules/planning";
import type { PromptRepositoryContext } from "../../../modules/prompt-construction";
import type { UserRequestEnvelope } from "../../../modules/request-intake";
import { extractPrimaryUserMessage } from "../../../modules/request-understanding/intent/extractPrimaryUserMessage";
import type { RequestUnderstandingResult } from "../../../modules/request-understanding";
import type { WindowPolicy } from "../../../modules/window-budget";

import {
  buildPlanningQuery,
  buildScopedRepoMapForPlanning,
  collectPreferredPlanningPaths,
  extractPriorPathHints,
  mergeContextPathsWithPriorHints,
  resolveFollowUpPlanningTaskSize,
  resolvePriorPathHintBudget,
  toPlanningBuildEvidence,
} from "../actions";
import type { AgentReasonCode } from "../contracts";
import type { ExecuteStartSharedState } from "./executeStartEarlyPipeline";

/**
 * Build validated PlanningInput for Engine enrichment: merge prior Ask path
 * hints, bump follow-up taskSize, and seed preferred discovery paths.
 */
export function preparePlanningInputFromEnrichment(params: {
  envelope: UserRequestEnvelope;
  understanding: RequestUnderstandingResult;
  conversation: readonly {
    role: string;
    content: string;
    toolCalls?: readonly { name: string; arguments: string }[];
  }[];
  contextPaths: readonly string[];
  repositoryContext: PromptRepositoryContext | undefined;
  selectedSkills:
    | Array<{ id: string; title?: string; content: string; priority?: number }>
    | undefined;
  shared: ExecuteStartSharedState;
  windowPolicy: WindowPolicy;
  route: PlanningInput["route"];
  planningDepth: PlanningInput["planningDepth"];
  explorationDepth: PlanningInput["explorationDepth"];
  reasonCodes: AgentReasonCode[];
}): {
  planningInput: PlanningParsedInput;
  knownPathHints: string[];
} {
  const {
    envelope,
    understanding,
    conversation,
    contextPaths,
    repositoryContext,
    selectedSkills,
    shared,
    windowPolicy,
    reasonCodes,
  } = params;

  const contextReviewed = (repositoryContext?.blocks ?? [])
    .slice(0, 20)
    .map((block) => ({
      kind: "file" as const,
      ref: block.relativePath,
    }));
  const planningEvidence = mapUnderstandingToPlanningEvidence(understanding);
  const liveQuery = extractPrimaryUserMessage(envelope.message);
  const planningQuery = buildPlanningQuery(liveQuery, conversation);
  const followUpTaskSize = resolveFollowUpPlanningTaskSize({
    currentTaskSize: planningEvidence.taskSize,
    currentQuery: liveQuery,
    conversation,
    planningQuery,
  });
  const planningEvidenceSized =
    followUpTaskSize !== planningEvidence.taskSize
      ? { ...planningEvidence, taskSize: followUpTaskSize }
      : planningEvidence;
  const priorBudget = resolvePriorPathHintBudget({
    currentQuery: liveQuery,
    conversation,
    mode: envelope.mode,
  });
  const priorPathHints = extractPriorPathHints(conversation, {
    max: priorBudget,
  });
  const planningContextPaths = mergeContextPathsWithPriorHints({
    contextPaths,
    priorPathHints,
  });
  if (
    planningContextPaths.length > contextPaths.length &&
    !reasonCodes.includes("plan_prior_path_hints_carried")
  ) {
    reasonCodes.push("plan_prior_path_hints_carried");
  }
  const knownPathHints = collectPreferredPlanningPaths({
    evidenceTargets: planningEvidenceSized.targets,
    contextPaths: planningContextPaths,
    priorPathHints,
    seedPaths: shared.executionSeed?.paths,
    query: planningQuery,
    max: priorBudget,
  });

  const planningInput = planningInputSchema.parse({
    schemaVersion: PLANNING_SCHEMA_VERSION,
    query: planningQuery,
    mode: envelope.mode,
    route: params.route,
    planningDepth: params.planningDepth,
    explorationDepth: params.explorationDepth,
    evidence: planningEvidenceSized,
    scopedRepoMap: buildScopedRepoMapForPlanning(planningContextPaths),
    buildEvidence: shared.repoBuildStateBefore
      ? toPlanningBuildEvidence(shared.repoBuildStateBefore)
      : undefined,
    skills: selectedSkills?.map((block) => ({
      id: block.id,
      title: block.title,
      content: block.content,
      priority: block.priority,
    })),
    processHints: [],
    contextReviewed: contextReviewed.length > 0 ? contextReviewed : undefined,
    ...(knownPathHints.length > 0 ? { knownPathHints } : {}),
    budgetTokens: windowPolicy.planning.budgetTokens,
    maxDiagnosticSteps: windowPolicy.planning.maxDiagnosticSteps,
    maxFilesPerBatch: windowPolicy.mutation.preferredBatchSize,
  } satisfies PlanningInput);

  return { planningInput, knownPathHints };
}
