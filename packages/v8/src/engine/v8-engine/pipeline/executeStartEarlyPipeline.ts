import type {
  DecisionPolicyInput,
  ExecutionDecision,
} from "../../../modules/decision-policy";
import {
  DECISION_POLICY_SCHEMA_VERSION,
  isExplicitWebSearchAsk,
  needsLiveWebEvidence,
} from "../../../modules/decision-policy";
import type {
  PlanArtifact,
  PlanStrategyDecision,
} from "../../../modules/planning";
import type {
  RepositoryStateReference,
} from "../../../modules/repository-state";
import type { UserRequestEnvelope } from "../../../modules/request-intake";
import { extractPrimaryUserMessage } from "../../../modules/request-understanding";
import type {
  RequestUnderstandingResult,
} from "../../../modules/request-understanding";
import type {
  RepoBuildState,
  VerificationRecord,
} from "../../../modules/verification";
import type { WindowPolicy } from "../../../modules/window-budget";

import {
  buildClarificationPayload,
  shouldCaptureUnconditionalAgentPreflight,
  amendMessageWithPriorConversation,
  buildUnderstandingHistoryDigest,
  buildDiagnosticSummary,
  collectUnderstandingCandidatePaths,
} from "../actions";
import {
  isExecutionSeedTrusted,
  resolveExecutionSeed,
} from "../modules/execution-seed";
import { handleMetaCommand } from "../modules/session-control";
import type { SessionControlRunResult } from "../contracts/output/AgentRunResult";
import { resolveSteeringFeatureFlags } from "../legacy/steeringFlags";
import type {
  AgentEngineStartInput,
  AgentReasonCode,
  AgentRunResult,
  AgentRunStatus,
} from "../contracts";
import { EventBus } from "../internal/EventBus";
import { RunBudgetTracker } from "../internal/RunBudget";
import {
  type TaskListRef,
} from "../internal/taskListRuntime";
import {
  SUPPORTED_EXECUTION_ROUTES,
} from "../legacy/policy";

import type { AgentEngineRuntime } from "./runtime";
import {
  buildSessionControlResult,
  captureAgentExecutePreflight,
} from "./earlyPipelineSupport";
import { resolveAndPinState } from "./pinAndDiscovery";
import {
  noteAutoApprovedPlanGate,
  resolveEffectivePlanApproval,
} from "./planGatePolicy";
import { applyClarificationResolutionOverlay } from "./clarificationResolutionOverlay";
import { applyStartReuse, type StartReuseState } from "./startReuse";
import { EXECUTION_ROUTE } from "../../../modules/decision-policy";
import {
  consultRuntimeGate,
  hubSuspendKind,
} from "../helpers/ConsultRuntimeGate";
import { saveSuspendedRun } from "../helpers/SaveSuspendedRun";

export type ExecuteStartSharedState = {
  pinnedState: RepositoryStateReference | undefined;
  requestId: string;
  route: AgentRunResult["route"];
  planningDepth: AgentRunResult["planningDepth"];
  runPlan: PlanArtifact | undefined;
  runPlanStrategy: PlanStrategyDecision | undefined;
  repoBuildStateBefore: RepoBuildState | undefined;
  repoBuildStateAfter: RepoBuildState | undefined;
  verificationRecord: VerificationRecord | undefined;
  executionSeed?: import("../modules/execution-seed").ExecutionSeed;
  /** Understanding used for this run; persisted at plan-approval suspension for resume reuse. */
  understanding?: RequestUnderstandingResult;
  /** Prose offer for remaining A/B/C campaign phases after this scope. */
  nextPlanPhaseOffer?: string;
};

export type StartEarlyPipelineContinue = {
  envelope: UserRequestEnvelope;
  understanding: RequestUnderstandingResult;
  decision: ExecutionDecision;
  candidateRelativePaths: string[];
  executionSeed: import("../modules/execution-seed").ExecutionSeed;
};

export type StartEarlyPipelineOutcome =
  | { kind: "terminal"; result: AgentRunResult }
  | { kind: "continue"; state: StartEarlyPipelineContinue };

/**
 * Intake → Pin → Agent-execute preflight → Understand → Decide.
 * Returns an early terminal result or continuation state for enrichment.
 */
export async function runStartEarlyPipeline(
  runtime: AgentEngineRuntime,
  params: {
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
  finish: (partial: {
    status: AgentRunStatus;
    route?: AgentRunResult["route"];
    planningDepth?: AgentRunResult["planningDepth"];
    answer?: string;
    suspension?: AgentRunResult["suspension"];
    pinnedState?: RepositoryStateReference;
    sessionControl?: SessionControlRunResult;
    reasonCodes?: AgentReasonCode[];
    warnings?: string[];
    error?: { code: string; message: string };
  }) => AgentRunResult;
  cancelledResult: () => Promise<AgentRunResult>;
  /** Plan-approval resume: skip pin / preflight / understand / decide. */
  reuse?: StartReuseState;
}): Promise<StartEarlyPipelineOutcome> {
  const {
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
  } = params;

  // --- Intake ---
  runtime.emitStage(bus, runId, "received", "started");
  const intakeDetailed = runtime.deps.intake.intakeDetailed?.bind(
    runtime.deps.intake,
  );
  const intakeResult = intakeDetailed
    ? intakeDetailed(input.request)
    : {
        envelope: runtime.deps.intake.intake(input.request),
        warnings: [] as string[],
        shortCircuitMeta: false,
      };
  const envelope = intakeResult.envelope;
  shared.requestId = envelope.requestId;
  reasonCodes.push("intake_complete");
  if (intakeResult.warnings.length > 0) {
    warnings.push(...intakeResult.warnings);
  }
  if (
    (envelope.referencedArtifacts?.length ?? 0) > 0 &&
    /\B@[^\s]/.test(envelope.message)
  ) {
    reasonCodes.push("intake_mentions_extracted");
  }
  runtime.emitStage(bus, runId, "received", "completed", ["intake_complete"]);

  // Meta slash commands (stop/new/clear/compact/…) never enter understand/pin.
  const shortCircuitMeta =
    intakeResult.shortCircuitMeta ||
    (envelope.metaCommand !== undefined &&
      envelope.metaCommand.lifecycle !== "agent_turn" &&
      !(
        envelope.metaCommand.lifecycle === "agent_turn_with_args" &&
        envelope.metaCommand.args.trim().length > 0
      ));
  if (shortCircuitMeta && envelope.metaCommand) {
    reasonCodes.push("intake_meta_command");
    const handled = handleMetaCommand({
      meta: envelope.metaCommand,
      conversation: input.conversation,
      estimator: runtime.tokenEstimator,
      windowPolicy,
      sessionId: envelope.sessionId,
    });
    reasonCodes.push(
      ...(handled.reasonCodes as AgentReasonCode[]).filter(
        (code) => !reasonCodes.includes(code),
      ),
    );
    if (handled.warnings.length > 0) {
      warnings.push(...handled.warnings);
    }
    warnings.push(
      `meta_command:${handled.command}:${handled.lifecycle}`,
    );

    const sessionControl = buildSessionControlResult(handled);

    return {
      kind: "terminal",
      result: finish({
        status: handled.status,
        answer: handled.answer,
        sessionControl,
        reasonCodes,
        ...(handled.error ? { error: handled.error } : {}),
      }),
    };
  }

  if (signal.aborted) {
    return { kind: "terminal", result: await cancelledResult() };
  }

  if (params.reuse) {
    return {
      kind: "continue",
      state: applyStartReuse({
        reuse: params.reuse,
        shared,
        reasonCodes,
        input,
        envelope,
      }),
    };
  }

  // --- Pin ---
  // Ahead of Decide/Understand now: pin whenever a workspace is
  // resolvable so an Agent-execute preflight snapshot (below) can run
  // before understanding, and so errors can inform classification.
  shared.pinnedState = await resolveAndPinState(runtime, {
    runId,
    envelope,
    input,
    bus,
    reasonCodes,
    warnings,
  });

  if (signal.aborted) {
    await runtime.safeUnpin(runId, shared.pinnedState);
    return { kind: "terminal", result: await cancelledResult() };
  }

  // --- Agent-execute preflight snapshot (before Understand) ---
  // Repair/mutation asks only. Status questions and "run the tests"
  // must not launch discovered e2e/WDIO scripts before the model runs.
  // Plan mode keeps its repair-intent-gated capture further down, once
  // understanding/decision exist.
  if (
    envelope.mode === "agent" &&
    shouldCaptureUnconditionalAgentPreflight(envelope.message)
  ) {
    await captureAgentExecutePreflight(runtime, {
      runId,
      input,
      envelope,
      bus,
      signal,
      reasonCodes,
      warnings,
      shared,
    });
  }

  if (signal.aborted) {
    await runtime.safeUnpin(runId, shared.pinnedState);
    return { kind: "terminal", result: await cancelledResult() };
  }

  // --- Understand ---
  // Module facade re-validates: message may be conversation-amended here.
  runtime.emitStage(bus, runId, "understood", "started");
  const understandingEnvelope: UserRequestEnvelope =
    input.conversation.length > 0
      ? {
          ...envelope,
          message: amendMessageWithPriorConversation(
            envelope.message,
            input.conversation,
            extractPrimaryUserMessage,
          ),
        }
      : envelope;
  const diagnosticSummary = shared.repoBuildStateBefore
    ? buildDiagnosticSummary(
        shared.repoBuildStateBefore,
        extractPrimaryUserMessage(understandingEnvelope.message),
      )
    : undefined;
  // Collect cheap path hints for *post-context* fuzzy resolution only.
  // Do not pass them into early understand(): sparse dirty/diagnostic
  // candidates can uniquely resolve a basename to the wrong file, lock
  // mutation scopes / context focus, and then block later correction.
  const candidateRelativePaths = collectUnderstandingCandidatePaths({
    dirtyPaths: input.dirtyPaths,
    diagnosticSummary,
    referencedArtifacts: understandingEnvelope.referencedArtifacts,
    userMessage: extractPrimaryUserMessage(understandingEnvelope.message),
  });
  const historyDigest = buildUnderstandingHistoryDigest(
    input.conversation ?? [],
  );
  // S2-RU: assessment ballot path — no RuleIntent dual-path merge.
  const understandingRaw = await runtime.deps.understanding.understand(
    understandingEnvelope,
    {
      useAssessmentBallot: true,
      ...(diagnosticSummary ? { diagnosticSummary } : {}),
      ...(historyDigest ? { historyDigest } : {}),
      ...(input.requiredMcpServerIds && input.requiredMcpServerIds.length > 0
        ? { requiredMcpServerIds: [...input.requiredMcpServerIds] }
        : {}),
    },
  );
  const understanding = applyClarificationResolutionOverlay(
    understandingRaw,
    input.clarificationResolution,
  );
  reasonCodes.push("understanding_complete");
  runtime.emitStage(bus, runId, "understood", "completed", [
    "understanding_complete",
  ]);

  if (signal.aborted) {
    await runtime.safeUnpin(runId, shared.pinnedState);
    return { kind: "terminal", result: await cancelledResult() };
  }

  const steering = resolveSteeringFeatureFlags(input.steering);

  const executionSeed = resolveExecutionSeed({
    userPrompt: extractPrimaryUserMessage(understandingEnvelope.message),
    understanding,
    repoBuildStateBefore: shared.repoBuildStateBefore,
    ...(diagnosticSummary ? { diagnosticSummary } : {}),
  });
  shared.executionSeed = executionSeed;
  reasonCodes.push(
    isExecutionSeedTrusted(executionSeed)
      ? "execution_seed_trusted"
      : "execution_seed_weak",
  );

  // --- Decide ---
  // Validates composed DecisionPolicyInput at its boundary (not a second
  // intake). Uses the original intake envelope, not the amended message.
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

  // S10-EVAC: early clarify via gates hub (after_decide).
  const clarifyVerdict = consultRuntimeGate("after_decide", {
    runId,
    route: decision.route,
    runDisposition: decision.runDisposition,
  });
  if (
    clarifyVerdict?.action === "suspend" ||
    decision.runDisposition === "clarification_required" ||
    decision.route === EXECUTION_ROUTE.CLARIFY
  ) {
    reasonCodes.push("clarification_suspended");
    warnings.push("gates_hub:after_decide");
    const suspendKind = hubSuspendKind(
      clarifyVerdict,
      "clarification_required",
    );
    const rationale =
      decision.rationale ||
      "Material clarification is required before continuing.";
    const clarification = buildClarificationPayload(
      understanding,
      rationale,
      { ballotV2: steering.understandingBallotV2 },
    );
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
