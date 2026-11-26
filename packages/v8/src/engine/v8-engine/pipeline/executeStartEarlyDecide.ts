/**
 * Early-start Decide phase: decision, web-search warn, clarify suspend, route guard.
 */
import type {
  DecisionPolicyInput,
  ExecutionDecision,
} from "../../../modules/decision-policy";
import {
  DECISION_POLICY_SCHEMA_VERSION,
  EXECUTION_ROUTE,
  isExplicitWebSearchAsk,
  needsLiveWebEvidence,
} from "../../../modules/decision-policy";
import type { UserRequestEnvelope } from "../../../modules/request-intake";
import { extractPrimaryUserMessage } from "../../../modules/request-understanding";
import type { RequestUnderstandingResult } from "../../../modules/request-understanding";
import type { WindowPolicy } from "../../../modules/window-budget";

import { buildClarificationPayload } from "../actions";
import {
  isExecutionSeedTrusted,
  type ExecutionSeed,
} from "../modules/execution-seed";
import { resolveSteeringFeatureFlags } from "../legacy/steeringFlags";
import type { AgentReasonCode, AgentRunResult } from "../contracts";
import { EventBus } from "../internal/EventBus";
import { RunBudgetTracker } from "../internal/RunBudget";
import type { TaskListRef } from "../internal/taskListRuntime";
import { SUPPORTED_EXECUTION_ROUTES } from "../legacy/policy";
import {
  consultRuntimeGate,
  hubSuspendKind,
} from "../helpers/ConsultRuntimeGate";
import { saveSuspendedRun } from "../helpers/SaveSuspendedRun";
import type { AgentEngineRuntime } from "./runtime";
import {
  noteAutoApprovedPlanGate,
  resolveEffectivePlanApproval,
} from "./planGatePolicy";
import type {
  ExecuteStartSharedState,
  StartEarlyFinish,
  StartEarlyPipelineOutcome,
} from "./executeStartEarlyPipelineTypes";
import type { AgentEngineStartInput } from "../contracts";

export async function runStartEarlyDecide(params: {
  runtime: AgentEngineRuntime;
  runId: string;
  input: AgentEngineStartInput;
  bus: EventBus;
  signal: AbortSignal;
  windowPolicy: WindowPolicy;
  budget: RunBudgetTracker;
  reasonCodes: AgentReasonCode[];
  warnings: string[];
  startedMs: number;
  shared: ExecuteStartSharedState;
  taskListRef: TaskListRef;
  finish: StartEarlyFinish;
  cancelledResult: () => Promise<AgentRunResult>;
  envelope: UserRequestEnvelope;
  understanding: RequestUnderstandingResult;
  executionSeed: ExecutionSeed;
  candidateRelativePaths: string[];
}): Promise<StartEarlyPipelineOutcome> {
  const {
    runtime,
    runId,
    input,
    bus,
    signal,
    windowPolicy,
    budget,
    reasonCodes,
    warnings,
    startedMs,
    shared,
    taskListRef,
    finish,
    cancelledResult,
    envelope,
    understanding,
    executionSeed,
    candidateRelativePaths,
  } = params;

  const steering = resolveSteeringFeatureFlags(input.steering);

  runtime.emitStage(bus, runId, "decided", "started");
  let decision = runtime.deps.decision.decide({
    schemaVersion: DECISION_POLICY_SCHEMA_VERSION,
    // Hand-written envelope types use readonly arrays; Zod infer is mutable.
    envelope: envelope as DecisionPolicyInput["envelope"],
    understanding,
    repositoryState: input.repositoryState,
    approvalMode: input.approvalMode,
    planApproval: resolveEffectivePlanApproval(input),
    hostCapabilities: {
      webSearch: runtime.deps.tools?.hasSearchPort?.() === true,
      diagnostics: runtime.deps.tools?.hasDiagnosticsPort?.() === true,
      ...((): {
        codeNavigation?: "available" | "degraded" | "unavailable";
        codeNavigationProvider?: "language_server" | "repo_graph" | "none";
      } => {
        const capability = runtime.deps.tools?.codeNavigationCapability?.();
        if (!capability) {
          return {};
        }
        return {
          codeNavigation: capability.status,
          codeNavigationProvider: capability.provider,
        };
      })(),
    },
    windowPolicy,
    userSafetyRules: input.userSafetyRules,
    policyFactsFirst: steering.policyFactsFirst,
    requiredMcpServerIds: input.requiredMcpServerIds,
  });
  if (
    isExecutionSeedTrusted(executionSeed) &&
    executionSeed.paths.length > 0 &&
    decision.toolGrant.maximumWorkspaceEffect === "write" &&
    runtime.deps.decision.narrow
  ) {
    decision = runtime.deps.decision.narrow({
      previous: decision,
      discoveredPaths: executionSeed.paths,
    });
    reasonCodes.push("grant_narrowed");
  }
  shared.route = decision.route;
  shared.planningDepth = decision.planningDepth;
  reasonCodes.push("decision_complete");
  runtime.emit(bus, {
    type: "decision_made",
    runId,
    route: decision.route,
    runDisposition: decision.runDisposition,
    maximumWorkspaceEffect: decision.toolGrant.maximumWorkspaceEffect,
    approvalMode: decision.toolGrant.approvalMode,
    pathScopes: decision.toolGrant.pathScopes.slice(0, 20),
    allowedTools: decision.toolGrant.allowedTools.slice(0, 40),
    commandPrefixes: (decision.toolGrant.commandRules ?? [])
      .flatMap((rule) => rule.prefixes)
      .slice(0, 40),
    trace: decision.trace,
    at: runtime.isoNow(),
  });

  runtime.emitStage(bus, runId, "decided", "completed", ["decision_complete"]);

  const userMessage = extractPrimaryUserMessage(envelope.message);
  const hasSearchPort = runtime.deps.tools?.hasSearchPort?.() === true;
  if (
    (isExplicitWebSearchAsk(
      userMessage,
      understanding.intent.classification.primaryTaskIntent,
    ) ||
      needsLiveWebEvidence(
        userMessage,
        understanding.intent.classification.primaryTaskIntent,
      )) &&
    !hasSearchPort &&
    !decision.toolGrant.allowedTools.includes("web_search")
  ) {
    const searchWarning =
      "Web search was needed but no SearchPort is configured. Set mitii.search.searxngBaseUrl (or SEARXNG_BASE_URL), BRAVE_API_KEY / MITII_SEARCH_API_KEY, or TAVILY_API_KEY to enable web_search.";
    warnings.push(searchWarning);
    runtime.emit(bus, {
      type: "warning",
      runId,
      message: searchWarning,
      at: runtime.isoNow(),
    });
  }

  noteAutoApprovedPlanGate(runtime, { runId, bus, warnings, decision });

  if (signal.aborted) {
    return { kind: "terminal", result: await cancelledResult() };
  }

  const clarifyOutcome = await maybeSuspendForClarification({
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
    finish,
    decision,
    understanding,
    steeringBallotV2: steering.understandingBallotV2,
  });
  if (clarifyOutcome) {
    return clarifyOutcome;
  }

  // All routes are supported; this only guards against a
  // future/unregistered route reaching the Engine unchanged.
  if (
    !(SUPPORTED_EXECUTION_ROUTES as readonly string[]).includes(decision.route)
  ) {
    reasonCodes.push("misconfigured");
    await runtime.safeUnpin(runId, shared.pinnedState);
    return {
      kind: "terminal",
      result: finish({
        status: "failed",
        route: decision.route,
        planningDepth: decision.planningDepth,
        reasonCodes,
        error: {
          code: "misconfigured",
          message: `Unsupported execution route: ${decision.route}.`,
        },
      }),
    };
  }

  shared.understanding = understanding;
  return {
    kind: "continue",
    state: {
      envelope,
      understanding,
      decision,
      candidateRelativePaths,
      executionSeed,
    },
  };
}

async function maybeSuspendForClarification(params: {
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
  finish: StartEarlyFinish;
  decision: ExecutionDecision;
  understanding: RequestUnderstandingResult;
  steeringBallotV2: boolean;
}): Promise<StartEarlyPipelineOutcome | undefined> {
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
    finish,
    decision,
    understanding,
    steeringBallotV2,
  } = params;

  // S10-EVAC: early clarify via gates hub (after_decide).
  const clarifyVerdict = consultRuntimeGate("after_decide", {
    runId,
    route: decision.route,
    runDisposition: decision.runDisposition,
  });
  if (
    !(
      clarifyVerdict?.action === "suspend" ||
      decision.runDisposition === "clarification_required" ||
      decision.route === EXECUTION_ROUTE.CLARIFY
    )
  ) {
    return undefined;
  }

  reasonCodes.push("clarification_suspended");
  warnings.push("gates_hub:after_decide");
  const suspendKind = hubSuspendKind(
    clarifyVerdict,
    "clarification_required",
  ) as NonNullable<AgentRunResult["suspension"]>["kind"];
  const rationale =
    decision.rationale ||
    "Material clarification is required before continuing.";
  const clarification = buildClarificationPayload(understanding, rationale, {
    ballotV2: steeringBallotV2,
  });
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
        changedFiles: [],
        mutationCheckpointIds: [],
        reasonCodes,
        warnings,
        usage: budget.snapshot(),
        startedAtMs: startedMs,
        repoBuildStateBefore: shared.repoBuildStateBefore,
        repoBuildStateAfter: shared.repoBuildStateAfter,
        ...(clarification.clarificationSession
          ? { clarificationSession: clarification.clarificationSession }
          : {}),
        ...(taskListRef.current ? { taskList: taskListRef.current } : {}),
        ...(taskListRef.completedPlanStepIds &&
        taskListRef.completedPlanStepIds.length > 0
          ? { completedPlanStepIds: [...taskListRef.completedPlanStepIds] }
          : {}),
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
  // Clarification doesn't need repository context; release the pin
  // taken above rather than leak it (checkpoint intentionally omits
  // pinnedState — a clarification resume re-pins on its own path).
  await runtime.safeUnpin(runId, shared.pinnedState);
  return {
    kind: "terminal",
    result: finish({
      status: "suspended",
      route: decision.route,
      planningDepth: decision.planningDepth,
      suspension: {
        kind: suspendKind,
        rationale,
        clarificationPrompt: clarification.clarificationPrompt,
        clarificationOptions:
          clarification.clarificationOptions.length > 0
            ? clarification.clarificationOptions
            : undefined,
      },
      reasonCodes,
    }),
  };
}
