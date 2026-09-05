import type {
  DecisionPolicyInput,
  ExecutionDecision,
} from "../../../modules/decision-policy";
import {
  DECISION_POLICY_SCHEMA_VERSION,
  isExplicitWebSearchAsk,
} from "../../../modules/decision-policy";
import type {
  PlanArtifact,
  PlanStrategyDecision,
} from "../../../modules/planning";
import type {
  RepositoryStateReference,
} from "../../../modules/repository-state";
import type { UserRequestEnvelope } from "../../../modules/request-intake";
import { extractPrimaryUserMessage } from "../../../modules/request-understanding/intent/extractPrimaryUserMessage";
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
  buildDiagnosticSummary,
  extractMentionedPaths,
  collectUnderstandingCandidatePaths,
} from "../actions";
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
  PHASE8_SUPPORTED_ROUTES,
} from "../policy";

import type { AgentEngineRuntime } from "./runtime";
import { resolveWorkspaceId } from "./runtime";
import {
  capturePreflightBuildState,
  resolveAndPinState,
} from "./pinAndDiscovery";
import {
  persistVerificationArtifact,
  tryLoadVerificationRetry,
} from "./verification";

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
};

export type StartEarlyPipelineContinue = {
  envelope: UserRequestEnvelope;
  understanding: RequestUnderstandingResult;
  decision: ExecutionDecision;
  candidateRelativePaths: string[];
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
    reasonCodes?: AgentReasonCode[];
    warnings?: string[];
    error?: { code: string; message: string };
  }) => AgentRunResult;
  cancelledResult: () => Promise<AgentRunResult>;
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
  const envelope = runtime.deps.intake.intake(input.request);
  shared.requestId = envelope.requestId;
  reasonCodes.push("intake_complete");
  runtime.emitStage(bus, runId, "received", "completed", ["intake_complete"]);

  if (signal.aborted) {
    return { kind: "terminal", result: await cancelledResult() };
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
    const retryRecord = await tryLoadVerificationRetry(runtime, {
      workspaceId: resolveWorkspaceId(input),
      userMessage: extractPrimaryUserMessage(envelope.message),
      runId,
      bus,
      warnings,
      logVerbosity: input.logVerbosity,
    });
    if (retryRecord) {
      shared.repoBuildStateBefore = retryRecord.after ?? retryRecord.before;
      shared.verificationRecord = retryRecord;
      reasonCodes.push("verification_retry_loaded");
      if (shared.repoBuildStateBefore) {
        runtime.emitRepoBuildStateCaptured(bus, runId, shared.repoBuildStateBefore);
      }
    } else {
      shared.repoBuildStateBefore = await capturePreflightBuildState(runtime, {
        runId,
        input,
        pinnedState: shared.pinnedState,
        contextPaths: [],
        bus,
        signal,
        reasonCodes,
        warnings,
        unconditional: true,
        mentionedPaths: extractMentionedPaths(
          extractPrimaryUserMessage(envelope.message),
        ),
      });
      if (shared.repoBuildStateBefore) {
        runtime.emitRepoBuildStateCaptured(bus, runId, shared.repoBuildStateBefore);
        shared.verificationRecord =
          (await persistVerificationArtifact(runtime, {
            runId,
            requestId: shared.requestId,
            workspaceId: resolveWorkspaceId(input),
            bus,
            reasonCodes,
            warnings,
            status: "captured_before",
            before: shared.repoBuildStateBefore,
            previous: shared.verificationRecord,
            logVerbosity: input.logVerbosity,
          })) ?? shared.verificationRecord;
      }
    }
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
  const understanding = await runtime.deps.understanding.understand(
    understandingEnvelope,
    {
      ...(diagnosticSummary ? { diagnosticSummary } : {}),
    },
  );
  reasonCodes.push("understanding_complete");
  runtime.emitStage(bus, runId, "understood", "completed", [
    "understanding_complete",
  ]);

  if (signal.aborted) {
    await runtime.safeUnpin(runId, shared.pinnedState);
    return { kind: "terminal", result: await cancelledResult() };
  }

  // --- Decide ---
  // Validates composed DecisionPolicyInput at its boundary (not a second
  // intake). Uses the original intake envelope, not the amended message.
  runtime.emitStage(bus, runId, "decided", "started");
  const decision = runtime.deps.decision.decide({
    schemaVersion: DECISION_POLICY_SCHEMA_VERSION,
    // Hand-written envelope types use readonly arrays; Zod infer is mutable.
    envelope: envelope as DecisionPolicyInput["envelope"],
    understanding,
    repositoryState: input.repositoryState,
    approvalMode: input.approvalMode,
    planApproval: input.planApproval,
    hostCapabilities: {
      webSearch: runtime.deps.tools?.hasSearchPort?.() === true,
    },
    windowPolicy,
    userSafetyRules: input.userSafetyRules,
  });
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
    isExplicitWebSearchAsk(
      userMessage,
      understanding.intent.classification.primaryTaskIntent,
    ) &&
    !hasSearchPort &&
    !decision.toolGrant.allowedTools.includes("web_search")
  ) {
    const searchWarning =
      "Web search was requested but no SearchPort is configured. Set BRAVE_API_KEY or MITII_SEARCH_API_KEY (VS Code: Mitii: Set Web Search API Key) to enable web_search.";
    warnings.push(searchWarning);
    runtime.emit(bus, {
      type: "warning",
      runId,
      message: searchWarning,
      at: runtime.isoNow(),
    });
  }

  if (signal.aborted) {
    return { kind: "terminal", result: await cancelledResult() };
  }

  // Clarification suspends without model/tools.
  if (
    decision.runDisposition === "clarification_required" ||
    decision.route === "clarify"
  ) {
    reasonCodes.push("clarification_suspended");
    const rationale =
      decision.rationale ||
      "Material clarification is required before continuing.";
    const clarification = buildClarificationPayload(
      understanding,
      rationale,
    );
    if (runtime.deps.checkpointStore) {
      await runtime.deps.checkpointStore.save({
        runId,
        requestId: shared.requestId,
        suspensionKind: "clarification_required",
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
        ...(taskListRef.current ? { taskList: taskListRef.current } : {}),
        ...(taskListRef.completedPlanStepIds &&
        taskListRef.completedPlanStepIds.length > 0
          ? { completedPlanStepIds: [...taskListRef.completedPlanStepIds] }
          : {}),
      });
    }
    runtime.emit(bus, {
      type: "suspended",
      runId,
      kind: "clarification_required",
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
          kind: "clarification_required",
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

  // All Phase 8 routes are supported; this only guards against a
  // future/unregistered route reaching the Engine unchanged.
  if (
    !(PHASE8_SUPPORTED_ROUTES as readonly string[]).includes(decision.route)
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

  return {
    kind: "continue",
    state: {
      envelope,
      understanding,
      decision,
      candidateRelativePaths,
    },
  };
}
