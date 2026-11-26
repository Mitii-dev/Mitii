/**
 * Post-plan-draft gates: A/B/C scope fork suspend, plan approval, Plan-mode terminal.
 */

import {
  askNeedsPlanScopeFork,
  type PlanArtifact,
  type PlanClarifyDraft,
  type PlanStrategyDecision,
} from "../../../modules/planning";
import type { ExecutionDecision } from "../../../modules/decision-policy";
import type { UserRequestEnvelope } from "../../../modules/request-intake";
import { ensurePlanClarifyDraft } from "../modules/plan-discovery";
import { shouldForceCampaignPhaseLock } from "../../../runtime";
import { applyPostPlanTaskListGate } from "../modules/execution-seed";
import type {
  AgentEngineStartInput,
  AgentReasonCode,
  AgentRunResult,
  AgentRunStatus,
  RunEvidence,
} from "../contracts";
import type {
  DiscoveryBrief,
  PlanningParsedInput,
} from "../../../modules/planning";
import { EventBus } from "../internal/EventBus";
import { RunBudgetTracker } from "../internal/RunBudget";
import type { TaskListRef } from "../internal/taskListRuntime";
import type { AgentEngineRuntime } from "./runtime";
import type { ExecuteStartSharedState } from "./executeStartEarlyPipeline";
import type { StartEnrichmentOutcome } from "./executeStartEnrichmentTypes";
import { recordPlanEvidence } from "../actions";
import { serializePlanForPrompt } from "../../../modules/planning";
import { maybeSuspendForPlanScopeFork } from "./enrichmentPlanScopeFork";
import { maybeSuspendAfterPlanScope } from "./enrichmentPlanAfterScope";

export async function maybeSuspendAfterPlanDraft(params: {
  runtime: AgentEngineRuntime;
  runId: string;
  input: AgentEngineStartInput;
  bus: EventBus;
  budget: RunBudgetTracker;
  reasonCodes: AgentReasonCode[];
  warnings: string[];
  startedMs: number;
  shared: ExecuteStartSharedState;
  taskListRef: TaskListRef;
  envelope: UserRequestEnvelope;
  decision: ExecutionDecision;
  plan: PlanArtifact;
  planStrategy: PlanStrategyDecision | undefined;
  clarifyDraft: PlanClarifyDraft | undefined;
  scopeChoiceResolved: boolean;
  planQualityFloor: boolean;
  skipPlanGate: boolean;
  /** Agent visible / large checklist: A/B/C even after concrete plan. */
  forceCampaignPhaseLock?: boolean;
  /** Clear single-outcome asks must not suspend for harness A/B/C. */
  askNeedsScopeFork?: boolean;
  /**
   * `all` — scope fork, then approval / Plan terminal (default).
   * `scope_fork` — only findings + A/B/C (run before Agent task-list gate).
   * `after_scope` — skip scope fork; approval / Plan terminal only.
   */
  phase?: "all" | "scope_fork" | "after_scope";
  finish: (partial: {
    status: AgentRunStatus;
    route?: AgentRunResult["route"];
    planningDepth?: AgentRunResult["planningDepth"];
    answer?: string;
    plan?: AgentRunResult["plan"];
    suspension?: AgentRunResult["suspension"];
    reasonCodes?: AgentReasonCode[];
  }) => AgentRunResult;
}): Promise<StartEnrichmentOutcome | undefined> {
  const {
    runtime,
    runId,
    input,
    bus,
    budget,
    reasonCodes,
    warnings,
    startedMs,
    shared,
    taskListRef,
    envelope,
    decision,
    plan,
    planStrategy,
    clarifyDraft,
    scopeChoiceResolved,
    planQualityFloor,
    skipPlanGate,
    forceCampaignPhaseLock = false,
    askNeedsScopeFork,
    phase = "all",
    finish,
  } = params;

  const runScopeFork = phase === "all" || phase === "scope_fork";
  const runAfterScope = phase === "all" || phase === "after_scope";

  if (runScopeFork) {
    const scopeFork = await maybeSuspendForPlanScopeFork({
      runtime,
      runId,
      input,
      bus,
      budget,
      reasonCodes,
      warnings,
      startedMs,
      shared,
      envelope,
      decision,
      plan,
      planStrategy,
      clarifyDraft,
      scopeChoiceResolved,
      planQualityFloor,
      forceCampaignPhaseLock,
      askNeedsScopeFork,
      finish,
    });
    if (scopeFork) {
      return scopeFork;
    }
  }

  if (phase === "scope_fork") {
    return undefined;
  }

  if (!runAfterScope) {
    return undefined;
  }

  return maybeSuspendAfterPlanScope({
    runtime,
    runId,
    input,
    bus,
    budget,
    reasonCodes,
    warnings,
    startedMs,
    shared,
    taskListRef,
    envelope,
    decision,
    plan,
    planStrategy,
    clarifyDraft,
    skipPlanGate,
    finish,
  });
}

type PostPlanFinish = Parameters<
  typeof maybeSuspendAfterPlanDraft
>[0]["finish"];

/**
 * Emit plan_ready, then: A/B/C scope fork → Agent task-list gate → approval / Plan terminal.
 * Scope fork first so hollow clarify never loses to `task_list_plan_not_concrete`.
 */
export async function runPostPlanDraftGates(params: {
  runtime: AgentEngineRuntime;
  runId: string;
  input: AgentEngineStartInput;
  bus: EventBus;
  budget: RunBudgetTracker;
  reasonCodes: AgentReasonCode[];
  warnings: string[];
  startedMs: number;
  shared: ExecuteStartSharedState;
  taskListRef: TaskListRef;
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
  mediumOrLarge: boolean;
  scopeChoiceResolved: boolean;
  planQualityFloor: boolean;
  skipPlanGate: boolean;
  syncTaskListOnce: () => void;
  finish: PostPlanFinish;
}): Promise<{ terminal?: StartEnrichmentOutcome; planText: string }> {
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

  const gateBase = {
    runtime,
    runId,
    input: params.input,
    bus,
    budget: params.budget,
    reasonCodes,
    warnings,
    startedMs: params.startedMs,
    shared,
    taskListRef: params.taskListRef,
    envelope: params.envelope,
    decision: params.decision,
    plan: planningResult.plan,
    planStrategy,
    clarifyDraft,
    scopeChoiceResolved: params.scopeChoiceResolved,
    planQualityFloor: params.planQualityFloor,
    skipPlanGate: params.skipPlanGate,
    forceCampaignPhaseLock,
    askNeedsScopeFork: needsScopeFork,
    finish: params.finish,
  };

  const scopeFork = await maybeSuspendAfterPlanDraft({
    ...gateBase,
    phase: "scope_fork",
  });
  if (scopeFork) {
    return { terminal: scopeFork, planText };
  }

  // Use remapped planStrategy — passing leftover `clarify` would skip the
  // concreteness gate and let hollow open-questions plans execute.
  const taskListGate = await applyPostPlanTaskListGate({
    runtime,
    mediumOrLarge: params.mediumOrLarge,
    mode: params.envelope.mode,
    plan: planningResult.plan,
    planStrategy,
    seed: shared.executionSeed,
    shared,
    taskListRef: params.taskListRef,
    reasonCodes,
    warnings,
    syncTaskListOnce: params.syncTaskListOnce,
    bus,
    runId,
    input: params.input,
    decision: params.decision,
    budget: params.budget,
    startedMs: params.startedMs,
    finish: params.finish,
  });
  if (taskListGate.kind === "terminal") {
    return { terminal: taskListGate, planText };
  }

  const afterPlan = await maybeSuspendAfterPlanDraft({
    ...gateBase,
    phase: "after_scope",
  });
  if (afterPlan) {
    return { terminal: afterPlan, planText };
  }
  return { planText };
}
