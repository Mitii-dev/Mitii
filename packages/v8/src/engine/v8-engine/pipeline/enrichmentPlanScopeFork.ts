/**
 * Post-plan A/B/C scope-fork suspend (gates hub after_plan).
 */
import type {
  PlanArtifact,
  PlanClarifyDraft,
  PlanStrategyDecision,
} from "../../../modules/planning";
import type { ExecutionDecision } from "../../../modules/decision-policy";
import type { UserRequestEnvelope } from "../../../modules/request-intake";
import { buildPlanClarifySuspension } from "../actions/buildPlanClarifySuspension";
import {
  consultRuntimeGate,
  hubSuspendKind,
} from "../helpers/ConsultRuntimeGate";
import type {
  AgentEngineStartInput,
  AgentReasonCode,
  AgentRunResult,
  AgentRunStatus,
} from "../contracts";
import { EventBus } from "../internal/EventBus";
import { RunBudgetTracker } from "../internal/RunBudget";
import { saveSuspendedRun } from "../helpers/SaveSuspendedRun";
import type { AgentEngineRuntime } from "./runtime";
import type { ExecuteStartSharedState } from "./executeStartEarlyPipeline";
import type { StartEnrichmentOutcome } from "./executeStartEnrichmentTypes";

type PostPlanFinish = (partial: {
  status: AgentRunStatus;
  route?: AgentRunResult["route"];
  planningDepth?: AgentRunResult["planningDepth"];
  answer?: string;
  plan?: AgentRunResult["plan"];
  suspension?: AgentRunResult["suspension"];
  reasonCodes?: AgentReasonCode[];
}) => AgentRunResult;

export async function maybeSuspendForPlanScopeFork(params: {
  runtime: AgentEngineRuntime;
  runId: string;
  input: AgentEngineStartInput;
  bus: EventBus;
  budget: RunBudgetTracker;
  reasonCodes: AgentReasonCode[];
  warnings: string[];
  startedMs: number;
  shared: ExecuteStartSharedState;
  envelope: UserRequestEnvelope;
  decision: ExecutionDecision;
  plan: PlanArtifact;
  planStrategy: PlanStrategyDecision | undefined;
  clarifyDraft: PlanClarifyDraft | undefined;
  scopeChoiceResolved: boolean;
  planQualityFloor: boolean;
  forceCampaignPhaseLock: boolean;
  askNeedsScopeFork: boolean | undefined;
  finish: PostPlanFinish;
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
  } = params;

  const scopeForkVerdict = consultRuntimeGate("after_plan", {
    runId,
    mode: envelope.mode,
    planStrategy: planStrategy?.strategy,
    hasClarifyDraft: Boolean(clarifyDraft),
    scopeChoiceResolved,
    qualityFloor: planQualityFloor,
    forceCampaignPhaseLock,
    askNeedsScopeFork,
  });
  const scopeForkSuspend =
    scopeForkVerdict?.action === "suspend" &&
    scopeForkVerdict.kind === "clarification_required" &&
    (scopeForkVerdict.payload as { clarifyOrigin?: string })?.clarifyOrigin ===
      "scope_fork";

  if (!scopeForkSuspend) {
    return undefined;
  }

  const clarify = buildPlanClarifySuspension(clarifyDraft!);
  reasonCodes.push("clarification_suspended");
  if (forceCampaignPhaseLock && planStrategy?.strategy !== "clarify") {
    reasonCodes.push("plan_scope_campaign_phase_lock");
  }
  warnings.push("gates_hub:scope_fork");
  const rationale =
    envelope.mode === "agent"
      ? forceCampaignPhaseLock && planStrategy?.strategy !== "clarify"
        ? "Multi-outcome plan drafted — choose scope (first phase) before execute so this run stays bounded."
        : "Choose scope (and optionally first delivery) before executing this Agent phase — keeps reads/turns bounded."
      : "Choose plan scope (and optionally first delivery) before a concrete Change plan is locked.";
  const suspendKind = hubSuspendKind(
    scopeForkVerdict,
    "clarification_required",
  ) as NonNullable<AgentRunResult["suspension"]>["kind"];
  if (runtime.deps.checkpointStore) {
    await saveSuspendedRun({
      store: runtime.deps.checkpointStore,
      checkpoint: {
        runId,
        requestId: shared.requestId,
        suspensionKind: suspendKind,
        input,
        decision,
        pinnedState: undefined,
        messages: [],
        toolCacheEntries: [],
        pendingApproval: undefined,
        plan,
        ...(planStrategy ? { planStrategy } : {}),
        clarificationSession: clarify.clarificationSession,
        changedFiles: [],
        mutationCheckpointIds: [],
        reasonCodes,
        warnings,
        usage: budget.snapshot(),
        startedAtMs: startedMs,
        repoBuildStateBefore: shared.repoBuildStateBefore,
        repoBuildStateAfter: shared.repoBuildStateAfter,
      },
    });
  }
  runtime.emit(bus, {
    type: "suspended",
    runId,
    kind: suspendKind,
    rationale,
    at: runtime.isoNow(),
  });
  await runtime.safeUnpin(runId, shared.pinnedState);
  return {
    kind: "terminal",
    result: finish({
      status: "suspended",
      route: decision.route,
      planningDepth: decision.planningDepth,
      plan,
      answer: clarify.answer,
      suspension: {
        kind: suspendKind,
        rationale,
        clarificationPrompt: clarify.clarificationPrompt,
        clarificationOptions: clarify.clarificationOptions,
        plan,
      },
      reasonCodes,
    }),
  };
}
