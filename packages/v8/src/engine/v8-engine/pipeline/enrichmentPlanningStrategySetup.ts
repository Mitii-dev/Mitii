/**
 * Prepare planning input, resolve strategy/scope, and apply plan-mode discovery contract.
 */
import type { ExecutionDecision } from "../../../modules/decision-policy";
import {
  resolvePlanStrategyRules,
  type PlanStrategyDecision,
} from "../../../modules/planning";
import type {
  PromptInstructions,
  PromptRepositoryContext,
} from "../../../modules/prompt-construction";
import type { UserRequestEnvelope } from "../../../modules/request-intake";
import type { RequestUnderstandingResult } from "../../../modules/request-understanding";
import type { WindowPolicy } from "../../../modules/window-budget";

import { preparePlanningInputFromEnrichment } from "./preparePlanningInputFromEnrichment";
import {
  applyPlanModeDiscoveryContract,
  applyPlanScopePhaseBounds,
  isAgentWidePlanningScope,
  requiresPlanDiscoveryQualityFloor,
  usesThoroughPlanDiscoveryEvidence,
} from "../modules/plan-discovery";
import type { AgentReasonCode } from "../contracts";
import type { AgentEngineStartInput } from "../contracts";
import type { ExecuteStartSharedState } from "./executeStartEarlyPipeline";

export type EnrichmentPlanningStrategySetup = {
  planningInput: ReturnType<
    typeof preparePlanningInputFromEnrichment
  >["planningInput"];
  knownPathHints: ReturnType<
    typeof preparePlanningInputFromEnrichment
  >["knownPathHints"];
  strategyDecision: PlanStrategyDecision;
  strategyOverride: PlanStrategyDecision;
  agentWideScope: boolean;
  taskSize: string | undefined;
  mediumOrLarge: boolean;
  resolvedScopeId: ReturnType<
    typeof applyPlanScopePhaseBounds
  >["resolvedScopeId"];
  scopeChoiceResolved: boolean;
  discoveryPreferredPaths: ReturnType<
    typeof applyPlanScopePhaseBounds
  >["discoveryPreferredPaths"];
  discoveryBudgetOverride: ReturnType<
    typeof applyPlanScopePhaseBounds
  >["discoveryBudgetOverride"];
  discoveryScopeHint: ReturnType<
    typeof applyPlanScopePhaseBounds
  >["discoveryScopeHint"];
  thoroughEvidence: boolean;
  planQualityFloor: boolean;
};

export function setupEnrichmentPlanningStrategy(params: {
  envelope: UserRequestEnvelope;
  understanding: RequestUnderstandingResult;
  input: AgentEngineStartInput;
  contextPaths: string[];
  repositoryContext: PromptRepositoryContext | undefined;
  selectedSkills: PromptInstructions["skills"];
  shared: ExecuteStartSharedState;
  windowPolicy: WindowPolicy;
  decision: ExecutionDecision;
  reasonCodes: AgentReasonCode[];
}): EnrichmentPlanningStrategySetup {
  const {
    envelope,
    understanding,
    input,
    contextPaths,
    repositoryContext,
    selectedSkills,
    shared,
    windowPolicy,
    decision,
    reasonCodes,
  } = params;

  const {
    planningInput: preparedPlanningInput,
    knownPathHints,
  } = preparePlanningInputFromEnrichment({
    envelope,
    understanding,
    conversation: input.conversation ?? [],
    contextPaths,
    repositoryContext,
    selectedSkills,
    shared,
    windowPolicy,
    route: decision.route,
    planningDepth: decision.planningDepth,
    explorationDepth: input.explorationDepth,
    reasonCodes,
  });
  let planningInput = preparedPlanningInput;

  // Engine owns strategy (rules only); Planning drafts against override.
  const strategyDecision = resolvePlanStrategyRules(planningInput);
  const agentWideScope = isAgentWidePlanningScope(planningInput.evidence);
  const taskSize = planningInput.evidence.taskSize;
  const mediumOrLarge =
    taskSize === "medium" || taskSize === "large";
  const scopePhase = applyPlanScopePhaseBounds({
    planningInput,
    knownPathHints,
    scopeChoice: {
      query: planningInput.query,
      conversation: input.conversation ?? [],
      optionId: input.clarificationResolution?.optionId,
      outcomeNote: input.clarificationResolution?.outcomeNote,
      label: input.clarificationResolution?.label,
    },
    taskSize,
    contextWindowTokens: windowPolicy.contextWindowTokens,
    reasonCodes,
  });
  planningInput = scopePhase.planningInput;
  const {
    resolvedScopeId,
    scopeChoiceResolved,
    discoveryPreferredPaths,
    discoveryBudgetOverride,
    discoveryScopeHint,
  } = scopePhase;
  if (scopePhase.nextPlanPhaseOffer) {
    shared.nextPlanPhaseOffer = scopePhase.nextPlanPhaseOffer;
  }
  const planContract = applyPlanModeDiscoveryContract({
    mode: envelope.mode,
    explorationDepth: input.explorationDepth,
    query: planningInput.query,
    conversation: input.conversation ?? [],
    strategy: strategyDecision,
    planningDepth: decision.planningDepth,
    agentWideScope,
    taskSize,
  });
  let strategyOverride: PlanStrategyDecision = planContract.strategy;
  if (planContract.applied) {
    reasonCodes.push(
      planContract.rationale === "plan_scope_choice_honored"
        ? "plan_scope_choice_honored"
        : envelope.mode === "agent"
          ? "agent_big_task_discovery_required"
          : "plan_mode_discovery_required",
    );
  } else if (
    scopeChoiceResolved &&
    !reasonCodes.includes("plan_scope_choice_honored")
  ) {
    reasonCodes.push("plan_scope_choice_honored");
  }
  const thoroughEvidence = usesThoroughPlanDiscoveryEvidence({
    mode: envelope.mode,
    planningDepth: decision.planningDepth,
  });
  const planQualityFloor = requiresPlanDiscoveryQualityFloor({
    mode: envelope.mode,
    explorationDepth: input.explorationDepth,
    planningDepth: decision.planningDepth,
    agentWideScope,
    taskSize,
  });

  return {
    planningInput,
    knownPathHints,
    strategyDecision,
    strategyOverride,
    agentWideScope,
    taskSize,
    mediumOrLarge,
    resolvedScopeId,
    scopeChoiceResolved,
    discoveryPreferredPaths,
    discoveryBudgetOverride,
    discoveryScopeHint,
    thoroughEvidence,
    planQualityFloor,
  };
}
