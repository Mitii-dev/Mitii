/**
 * Emit plan_ready + synthesize clarify/campaign inputs before post-plan gates.
 */
import {
  askNeedsPlanScopeFork,
  serializePlanForPrompt,
  type PlanArtifact,
  type PlanClarifyDraft,
  type PlanStrategyDecision,
  type DiscoveryBrief,
  type PlanningParsedInput,
} from "../../../modules/planning";
import type { ExecutionDecision } from "../../../modules/decision-policy";
import type { UserRequestEnvelope } from "../../../modules/request-intake";
import { ensurePlanClarifyDraft } from "../modules/plan-discovery";
import { shouldForceCampaignPhaseLock } from "../../../runtime";
import type { AgentReasonCode, RunEvidence } from "../contracts";
import type { EventBus } from "../internal/EventBus";
import { recordPlanEvidence } from "../actions";
import type { AgentEngineRuntime } from "./runtime";
import type { ExecuteStartSharedState } from "./executeStartEarlyPipeline";

export type AfterPlanDraftPrepared = {
  planText: string;
  planStrategy: PlanStrategyDecision | undefined;
  clarifyDraft: PlanClarifyDraft | undefined;
  forceCampaignPhaseLock: boolean;
  needsScopeFork: boolean;
};

export function prepareAfterPlanDraft(params: {
  runtime: AgentEngineRuntime;
  runId: string;
  bus: EventBus;
  shared: ExecuteStartSharedState;
  reasonCodes: AgentReasonCode[];
  warnings: string[];
  runEvidence: RunEvidence;
  envelope: UserRequestEnvelope;
  decision: ExecutionDecision;
  planningResult: {
    plan: PlanArtifact;
    strategy?: PlanStrategyDecision;
    clarifyDraft?: PlanClarifyDraft;
  };
  planningInput: PlanningParsedInput;
  discoveryBrief?: DiscoveryBrief;
  planQualityFloor: boolean;
}): AfterPlanDraftPrepared {
  const {
    runtime,
    runId,
    bus,
    shared,
    reasonCodes,
    warnings,
    planningResult,
    planningInput,
    discoveryBrief,
  } = params;

  shared.runPlan = planningResult.plan;
  shared.runPlanStrategy = planningResult.strategy;
  recordPlanEvidence(params.runEvidence, planningResult.plan);
  const planText = serializePlanForPrompt(
    planningResult.plan,
    planningResult.strategy,
  );
  reasonCodes.push("plan_drafted");
  runtime.emit(bus, {
    type: "plan_ready",
    runId,
    planningDepth: params.decision.planningDepth,
    phaseCount: planningResult.plan.phases.length,
    approvalRequired: planningResult.plan.approvalRequired,
    plan: planningResult.plan,
    at: runtime.isoNow(),
  });
  runtime.emitEvidenceUpdated(bus, runId, params.runEvidence);
  runtime.emitStage(bus, runId, "plan_ready", "completed", ["plan_drafted"]);

  const changeStepCount = (planningResult.plan.phases ?? []).reduce(
    (sum, phase) => {
      const isChangePhase = /change|implement|edit/i.test(
        `${phase.id ?? ""} ${phase.name ?? ""}`,
      );
      const steps = phase.steps ?? [];
      if (isChangePhase) {
        return sum + steps.length;
      }
      return (
        sum +
        steps.filter((step) =>
          /change|implement|edit|add|update|write/i.test(
            `${step.id ?? ""} ${step.intent ?? ""} ${step.actionSummary ?? ""}`,
          ),
        ).length
      );
    },
    0,
  );
  const needsScopeFork = askNeedsPlanScopeFork({
    clarity: planningInput.evidence.clarity,
    primaryIntent: planningInput.evidence.primaryIntent,
    requestedOutcomes: planningInput.evidence.requestedOutcomes,
    query: planningInput.query,
  });
  const forceCampaignPhaseLock = shouldForceCampaignPhaseLock({
    mode: params.envelope.mode,
    planningDepth: params.decision.planningDepth,
    changeStepCount,
    qualityFloor: params.planQualityFloor,
    askNeedsScopeFork: needsScopeFork,
  });

  const clarifyDraft = needsScopeFork
    ? ensurePlanClarifyDraft({
        strategy: planningResult.strategy,
        clarifyDraft: planningResult.clarifyDraft,
        planningInput,
        discoveryBrief,
        forceForCampaignPhaseLock: forceCampaignPhaseLock,
      })
    : undefined;
  if (clarifyDraft && !planningResult.clarifyDraft && needsScopeFork) {
    warnings.push(
      forceCampaignPhaseLock && planningResult.strategy?.strategy !== "clarify"
        ? "Synthesized findings + A/B/C chips for campaign phase-lock after a concrete plan."
        : "Synthesized findings + A/B/C clarify draft after insufficient discovery (Planning omitted clarifyDraft).",
    );
  }

  // Never carry a leftover clarify strategy into execute for clear single-outcome
  // asks — that path used to skip A/B/C UI then mutate a hollow open-questions plan.
  const planStrategy =
    !needsScopeFork && planningResult.strategy?.strategy === "clarify"
      ? {
          ...planningResult.strategy,
          strategy: "discover_and_plan" as const,
          rationale:
            "Clear single-outcome ask — kept discover_and_plan instead of harness clarify.",
          skipDiscover: true,
        }
      : planningResult.strategy;
  shared.runPlanStrategy = planStrategy;

  return {
    planText,
    planStrategy,
    clarifyDraft,
    forceCampaignPhaseLock,
    needsScopeFork,
  };
}
