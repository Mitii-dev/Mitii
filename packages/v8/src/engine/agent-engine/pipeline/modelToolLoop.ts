import type {
  ExecutionDecision,
} from "../../../modules/decision-policy";
import type {
  ModelMessage,
  ModelRequest,
} from "../../../modules/model-gateway";
import type {
  PlanArtifact,
} from "../../../modules/planning";
import type {
  ProjectDescriptor,
  RepositoryStateReference,
} from "../../../modules/repository-state";
import type { WindowPolicy } from "../../../modules/window-budget";
import type {
  RequestUnderstandingResult,
} from "../../../modules/request-understanding";
import type {
  RepoBuildState,
} from "../../../modules/verification";

import {
  buildOutputTruncationRecovery,
  estimateStickyMutableChars,
  compactRecoveredAssistantContent,
  requiresMutationForExecute,
  reservedVerificationRepairModelCalls,
  recoverLeakedToolCallsFromMarkup,
} from "../actions";
import type {
  EstablishedFact,
} from "../actions";
import { ToolCallCache } from "../internal/ToolCallCache";
import { ReadLedger } from "../internal/ReadLedger";
import type {
  AgentReasonCode,
  RunEvidence,
} from "../contracts";
import { EventBus } from "../internal/EventBus";
import { RunBudgetTracker } from "../internal/RunBudget";
import {
  type AgentLogVerbosity,
} from "../internal/logVerbosity";
import {
  type TaskListRef,
} from "../internal/taskListRuntime";
import {
  AGENT_ENGINE_THRESHOLDS,
} from "../policy";
import type { AgentEngineThresholds } from "../actions/resolveAgentEngineThresholds";

import type { AgentEngineRuntime } from "./runtime";
import type {
  ToolLoopOutcome,
} from "./types";

import { consumeModelTurn } from "./consumeModelTurn";
import { appendTextContinuation } from "./appendTextContinuation";
export { appendTextContinuation } from "./appendTextContinuation";
import { prepareModelLoopTurn } from "./prepareModelLoopTurn";
import type { ModelLoopSession } from "./modelLoopSession";
import { handleNoToolModelTurn } from "./modelLoopNoToolTurn";
import { runModelLoopToolPhase } from "./modelLoopToolPhase";
import { resolveModelLoopAfterTools } from "./modelLoopAfterTools";
import { createLoopFileReadTracker } from "../actions";

export async function runModelToolLoop(
  runtime: AgentEngineRuntime,
  params: {
  runId: string;
  request: ModelRequest;
  decision: ExecutionDecision;
  understanding?: RequestUnderstandingResult;
  skillsQuery?: string;
  mode?: "ask" | "plan" | "agent";
  projects?: readonly ProjectDescriptor[];
  dirtyPaths: readonly string[] | undefined;
  pinnedState: RepositoryStateReference | undefined;
  workspaceRoot: string | undefined;
  bus: EventBus;
  signal: AbortSignal;
  budget: RunBudgetTracker;
  reasonCodes: AgentReasonCode[];
  warnings: string[];
  messages: ModelMessage[];
  toolCache: ToolCallCache;
  changedFiles: string[];
  mutationCheckpointIds: string[];
  memoryFacts?: readonly { id: string; content: string }[];
  establishedFacts?: EstablishedFact[];
  selectedSkillIds?: string[];
  requiredSkillIds?: string[];
  taskListRef: TaskListRef;
  evidence?: RunEvidence;
  windowPolicy: WindowPolicy;
  repoBuildStateBefore?: RepoBuildState;
  logVerbosity: AgentLogVerbosity;
  /**
   * First mutate loop only: hold back window-effort repair calls so
   * remaining-error verification can start after a productive loop.
   */
  reserveVerificationRepairModelCalls?: boolean;
  plan?: PlanArtifact;
  /**
   * Resolved loop/stall thresholds (working standards + optional host overrides).
   * When omitted, shipped `AGENT_ENGINE_THRESHOLDS` apply.
   */
  thresholds?: AgentEngineThresholds;
}): Promise<ToolLoopOutcome> {
  const {
    runId,
    dirtyPaths,
    pinnedState,
    workspaceRoot,
    bus,
    signal,
    budget,
    reasonCodes,
    warnings,
    messages,
    toolCache,
    changedFiles,
    mutationCheckpointIds,
    taskListRef,
    evidence,
    logVerbosity,
  } = params;
  const thresholds = params.thresholds ?? AGENT_ENGINE_THRESHOLDS;
  const establishedFacts = params.establishedFacts ?? [];
  const readLedger = new ReadLedger();
  const loopFileReads = createLoopFileReadTracker();
  const mustReadNudgeBudget = {
    remaining: thresholds.maxMustReadNudges,
  };
  const changeImpactGate = {
    required:
      params.decision.reasonCodes.includes("change_impact_recommended") &&
      params.decision.toolGrant.allowedTools.includes("analyze_change_impact"),
    satisfied: false,
  };

  const session: ModelLoopSession = {
    decision: params.decision,
    selectedSkillIds: [...(params.selectedSkillIds ?? [])],
    answer: "",
    truncationRecoveries: 0,
    incompleteAnswerRecoveries: 0,
    unfulfilledExecuteRecoveries: 0,
    pendingTextContinuation: "",
    emittedLoopPressureWarning: false,
    emittedLoopCompactionWarning: false,
    successfulVerificationAfterMutation: false,
    explorationStallNudges: 0,
    rejectedMutationRecoveries: 0,
    rejectedToolRecoveries: 0,
    readOnlyToolTurnsWithoutMutation: 0,
    readOnlyToolTurnsAfterMutation: 0,
    afterMutationReadOnlyNudges: 0,
    awaitingReadOnlyMutationRetry: false,
    readOnlyMutationRetryAttempts: 0,
    mutationBlockerAsked: false,
    awaitingRejectedMutationRetry: undefined,
    lastPromptCacheClass: undefined,
  };

  const isMutationRequired = () =>
    requiresMutationForExecute({
      route: session.decision.route,
      maximumWorkspaceEffect: session.decision.toolGrant.maximumWorkspaceEffect,
      primaryTaskIntent:
        params.understanding?.intent.classification.primaryTaskIntent,
      reasonCodes: session.decision.reasonCodes,
    });

  while (true) {
    if (signal.aborted) {
      return { kind: "cancelled" };
    }

    const exhausted = budget.isExhausted();
    if (exhausted) {
      return {
        kind: "budget_exhausted",
        answer: session.answer || undefined,
        message: `Run budget exhausted (${exhausted}).`,
        changedFiles,
        mutationCheckpointIds,
      };
    }

    const reservedRepairCalls =
      params.reserveVerificationRepairModelCalls === true
        ? reservedVerificationRepairModelCalls({
            maxModelCalls: budget.maxModelCalls(),
            maxVerificationRepairs:
              params.windowPolicy.run.maxVerificationRepairs,
            thresholds,
          })
        : 0;
    const reserveForThisTurn =
      changedFiles.length > 0 ? reservedRepairCalls : 0;
    if (!budget.canStartModelCall(reserveForThisTurn)) {
      if (changedFiles.length > 0 && budget.canStartModelCall()) {
        reasonCodes.push("verification_repair_budget_reserved");
        warnings.push(
          "Leaving remaining model-call budget for verification repair after mutations.",
        );
        return {
          kind: "completed",
          answer: session.answer,
          changedFiles,
          mutationCheckpointIds,
          messages,
          toolCache,
          decision: session.decision,
        };
      }
      return {
        kind: "budget_exhausted",
        answer: session.answer || undefined,
        message: "Model call budget exhausted.",
        changedFiles,
        mutationCheckpointIds,
      };
    }

    budget.recordLoopIteration();
    budget.recordModelCall();
    runtime.emitStage(bus, runId, "model_running", "started");

    const prepared = prepareModelLoopTurn({
      runtime,
      runId,
      bus,
      request: params.request,
      messages,
      budget,
      windowPolicy: params.windowPolicy,
      taskListRef,
      grantPathScopes: session.decision.toolGrant.pathScopes,
      mutationBudget: session.decision.toolGrant.mutationBudget,
      repoBuildStateBefore: params.repoBuildStateBefore,
      memoryFacts: params.memoryFacts,
      establishedFacts,
      reasonCodes,
      warnings,
      logVerbosity,
      lastPromptCacheClass: session.lastPromptCacheClass,
      emittedLoopPressureWarning: session.emittedLoopPressureWarning,
      emittedLoopCompactionWarning: session.emittedLoopCompactionWarning,
    });
    session.emittedLoopPressureWarning = prepared.emittedLoopPressureWarning;
    session.emittedLoopCompactionWarning = prepared.emittedLoopCompactionWarning;
    session.lastPromptCacheClass = prepared.promptCacheClass;
    const { turnRequest, preservePrefix, promptCacheClass, compaction } =
      prepared;

    const stickyMutable = estimateStickyMutableChars(turnRequest.messages);
    const turn = await consumeModelTurn(runtime, {
      llm: runtime.deps.llm,
      request: turnRequest,
      runId,
      signal,
      bus,
    });

    if (turn.kind === "cancelled") {
      runtime.emitStage(bus, runId, "model_running", "completed", ["cancelled"]);
      return { kind: "cancelled" };
    }

    if (turn.kind === "failed") {
      reasonCodes.push("provider_failed");
      runtime.emitStage(bus, runId, "model_running", "completed", [
        "provider_failed",
      ]);
      return {
        kind: "failed",
        answer: turn.content || session.answer || undefined,
        extraReasons: ["provider_failed"],
        error: {
          code: turn.errorCode,
          message: turn.errorMessage,
        },
      };
    }

    if (turn.usage) {
      budget.addUsage(turn.usage);
    }

    const truncated = turn.finishReason === "length";
    runtime.emit(bus, {
      type: "model_turn",
      runId,
      turnIndex: Math.max(0, budget.snapshot().modelCalls - 1),
      inputTokens: turn.usage?.inputTokens,
      outputTokens: turn.usage?.outputTokens,
      cacheHitTokens: turn.usage?.cacheHitTokens,
      cacheMissTokens: turn.usage?.cacheMissTokens,
      finishReason: turn.finishReason,
      truncated: truncated || undefined,
      preservePrefix,
      promptCacheClass,
      stickyInputChars: stickyMutable.stickyChars,
      mutableInputChars: stickyMutable.mutableChars,
      compactionPressure: compaction.pressure,
      at: runtime.isoNow(),
    });

    if (truncated) {
      reasonCodes.push("output_truncated");
      warnings.push(
        "Model output stopped early because the output token limit was reached.",
      );
      runtime.emit(bus, {
        type: "warning",
        runId,
        message:
          "Response truncated: output token limit reached. Retrying with a smaller mutation batch when tools were incomplete; otherwise raise mitii.provider.maximumOutputTokens.",
        at: runtime.isoNow(),
      });
    }

    const grant = session.decision.toolGrant;
    const recovery = buildOutputTruncationRecovery({
      finishReason: turn.finishReason,
      content: turn.content,
      toolCalls: turn.toolCalls,
      mutationBudget: grant.mutationBudget,
      recoveryAttempt: session.truncationRecoveries,
      requireMutation: requiresMutationForExecute({
        route: session.decision.route,
        maximumWorkspaceEffect: grant.maximumWorkspaceEffect,
        primaryTaskIntent:
          params.understanding?.intent.classification.primaryTaskIntent,
        reasonCodes: session.decision.reasonCodes,
      }),
      thresholds,
    });

    if (recovery?.shouldRecover) {
      session.truncationRecoveries += 1;
      reasonCodes.push("output_truncation_recovered");
      if (recovery.recoveryKind === "text_continuation") {
        session.pendingTextContinuation = appendTextContinuation(
          session.pendingTextContinuation,
          recovery.assistantContent,
        );
        session.answer = session.pendingTextContinuation;
      }
      messages.push({
        role: "assistant",
        content: compactRecoveredAssistantContent(
          recovery.assistantContent,
          thresholds.maxRecoveredAnalysisChars,
        ),
      });
      messages.push(recovery.recoveryMessage);
      runtime.emit(bus, {
        type: "warning",
        runId,
        message:
          recovery.recoveryKind === "text_continuation"
            ? "Continuing truncated final answer after output token limit."
            : "Discarded incomplete truncated tool call(s); continuing with a smaller-batch instruction.",
        at: runtime.isoNow(),
      });
      runtime.emitStage(bus, runId, "model_running", "completed", [
        "model_completed",
        "output_truncated",
        "output_truncation_recovered",
      ]);
      continue;
    }

    reasonCodes.push("model_completed");
    runtime.emitStage(bus, runId, "model_running", "completed", [
      "model_completed",
      ...(truncated ? (["output_truncated"] as const) : []),
    ]);

    let toolCalls = turn.toolCalls;
    if (
      toolCalls.length === 0 &&
      turn.content.trim().length > 0 &&
      /<\s*(?:read_file|read_many_files|search_files|glob_files|list_directory|goto_definition|find_references|analyze_change_impact)\b/i.test(
        turn.content,
      )
    ) {
      const recovered = recoverLeakedToolCallsFromMarkup({
        content: turn.content,
        allowedToolNames: new Set(grant.allowedTools),
      });
      toolCalls = recovered.toolCalls;
      if (recovered.warnings.length > 0) {
        warnings.push(...recovered.warnings);
      }
    }

    if (toolCalls.length === 0) {
      const noTool = handleNoToolModelTurn({
        runtime,
        runId,
        bus,
        session,
        decision: session.decision,
        grant,
        understanding: params.understanding,
        turnContent: turn.content,
        finishReason: turn.finishReason,
        truncated,
        changedFiles,
        mutationCheckpointIds,
        messages,
        toolCache,
        budget,
        reasonCodes,
        warnings,
        thresholds,
      });
      if (noTool.kind === "return") {
        return noTool.outcome;
      }
      continue;
    }

    const toolPhase = await runModelLoopToolPhase({
      runtime,
      runId,
      bus,
      signal,
      session,
      toolCalls,
      turnContent: turn.content,
      dirtyPaths,
      pinnedState,
      workspaceRoot,
      messages,
      toolCache,
      readLedger,
      budget,
      warnings,
      reasonCodes,
      changedFiles,
      mutationCheckpointIds,
      taskListRef,
      evidence,
      establishedFacts,
      windowPolicy: params.windowPolicy,
      loopFileReads,
      mustReadNudgeBudget,
      plan: params.plan,
      understanding: params.understanding,
      skillsQuery: params.skillsQuery,
      mode: params.mode,
      projects: params.projects,
      requiredSkillIds: params.requiredSkillIds,
      answer: session.answer,
      changeImpactGate,
    });
    if (toolPhase.kind !== "batch_done") {
      if (toolPhase.kind === "return") {
        return toolPhase.outcome;
      }
      continue;
    }

    const after = resolveModelLoopAfterTools({
      runtime,
      runId,
      bus,
      session,
      decision: session.decision,
      grant: session.decision.toolGrant,
      toolCalls,
      stats: toolPhase.stats,
      isMutationRequired,
      changedFiles,
      mutationCheckpointIds,
      messages,
      toolCache,
      budget,
      reasonCodes,
      warnings,
      thresholds,
      taskListRef,
      loopFileReads,
      logVerbosity,
    });
    if (after.kind === "return") {
      return after.outcome;
    }
  }
}
