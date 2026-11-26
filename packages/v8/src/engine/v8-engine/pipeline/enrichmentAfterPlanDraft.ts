/**
 * Post-plan-draft gates: A/B/C scope fork suspend, plan approval, Plan-mode terminal.
 */

import type {
  PlanArtifact,
  PlanClarifyDraft,
  PlanStrategyDecision,
} from "../../../modules/planning";
import type { ExecutionDecision } from "../../../modules/decision-policy";
import type { UserRequestEnvelope } from "../../../modules/request-intake";
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
import type { EventBus } from "../internal/EventBus";
import type { RunBudgetTracker } from "../internal/RunBudget";
import type { TaskListRef } from "../internal/taskListRuntime";
import type { AgentEngineRuntime } from "./runtime";
import type { ExecuteStartSharedState } from "./executeStartEarlyPipeline";
import type { StartEnrichmentOutcome } from "./executeStartEnrichmentTypes";
import { maybeSuspendForPlanScopeFork } from "./enrichmentPlanScopeFork";
import { maybeSuspendAfterPlanScope } from "./enrichmentPlanAfterScope";
import { prepareAfterPlanDraft } from "./enrichmentAfterPlanDraftPrepare";

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
  const prepared = prepareAfterPlanDraft({
    runtime: params.runtime,
    runId: params.runId,
    bus: params.bus,
    shared: params.shared,
    reasonCodes: params.reasonCodes,
    warnings: params.warnings,
    runEvidence: params.runEvidence,
    envelope: params.envelope,
    decision: params.decision,
    planningResult: params.planningResult,
    planningInput: params.planningInput,
    discoveryBrief: params.discoveryBrief,
    planQualityFloor: params.planQualityFloor,
  });

  const gateBase = {
    runtime: params.runtime,
    runId: params.runId,
    input: params.input,
    bus: params.bus,
    budget: params.budget,
    reasonCodes: params.reasonCodes,
    warnings: params.warnings,
    startedMs: params.startedMs,
    shared: params.shared,
    taskListRef: params.taskListRef,
    envelope: params.envelope,
    decision: params.decision,
    plan: params.planningResult.plan,
    planStrategy: prepared.planStrategy,
    clarifyDraft: prepared.clarifyDraft,
    scopeChoiceResolved: params.scopeChoiceResolved,
    planQualityFloor: params.planQualityFloor,
    skipPlanGate: params.skipPlanGate,
    forceCampaignPhaseLock: prepared.forceCampaignPhaseLock,
    askNeedsScopeFork: prepared.needsScopeFork,
    finish: params.finish,
  };

  const scopeFork = await maybeSuspendAfterPlanDraft({
    ...gateBase,
    phase: "scope_fork",
  });
  if (scopeFork) {
    return { terminal: scopeFork, planText: prepared.planText };
  }

  // Use remapped planStrategy — passing leftover `clarify` would skip the
  // concreteness gate and let hollow open-questions plans execute.
  const taskListGate = await applyPostPlanTaskListGate({
    runtime: params.runtime,
    mediumOrLarge: params.mediumOrLarge,
    mode: params.envelope.mode,
    plan: params.planningResult.plan,
    planStrategy: prepared.planStrategy,
    seed: params.shared.executionSeed,
    shared: params.shared,
    taskListRef: params.taskListRef,
    reasonCodes: params.reasonCodes,
    warnings: params.warnings,
    syncTaskListOnce: params.syncTaskListOnce,
    bus: params.bus,
    runId: params.runId,
    input: params.input,
    decision: params.decision,
    budget: params.budget,
    startedMs: params.startedMs,
    finish: params.finish,
  });
  if (taskListGate.kind === "terminal") {
    return { terminal: taskListGate, planText: prepared.planText };
  }

  const afterPlan = await maybeSuspendAfterPlanDraft({
    ...gateBase,
    phase: "after_scope",
  });
  if (afterPlan) {
    return { terminal: afterPlan, planText: prepared.planText };
  }
  return { planText: prepared.planText };
}
