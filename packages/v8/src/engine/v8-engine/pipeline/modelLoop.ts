import type {
  ExecutionDecision,
} from "../../../modules/decision-policy";
import type {
  LlmPort,
  ModelMessage,
  ModelRequest,
} from "../../../modules/model-gateway";
import type { AgentMode } from "../../../modules/request-intake";
import type {
  RepositoryStateReference,
} from "../../../modules/repository-state";
import type { RequestUnderstandingResult } from "../../../modules/request-understanding";
import type { WindowPolicy } from "../../../modules/window-budget";
import type { RepoBuildState } from "../../../modules/verification";

import type {
  AgentReasonCode,
  RunEvidence,
} from "../contracts";
import type { EstablishedFact } from "../actions";
import type { PromptCacheClass } from "../actions/resolvePromptCacheClass";
import {
  createLoopFileReadTracker,
  estimateStickyMutableChars,
} from "../actions";
import { EventBus } from "../internal/EventBus";
import { ReadLedger } from "../internal/ReadLedger";
import { RunBudgetTracker } from "../internal/RunBudget";
import { ToolCallCache } from "../internal/ToolCallCache";
import type { ContextEpoch } from "../internal/context-epoch";
import { InMemorySessionHistoryArchive } from "../internal/session-history";
import type { AgentLogVerbosity } from "../internal/logVerbosity";
import type { TaskListRef } from "../internal/taskListRuntime";
import { consumeModelTurn } from "./consumeModelTurn";
import { tryOfferBudgetWallContinue } from "./tryOfferBudgetWallContinue";
import type { AgentEngineRuntime } from "./runtime";
import type { ToolLoopOutcome } from "./types";
import type { SteeringCriticMode } from "../legacy/steeringFlags";

import type { V8EngineThresholdsOverrides } from "../policy";
import { V8_ENGINE_THRESHOLDS } from "../policy";
import {
  resolveV8LoopPolicyThresholds,
} from "../policy/bands";
import {
  ToolLoopGuard,
  forceFinalToolLoopMessage,
  softToolLoopNudgeMessage,
} from "../actions/toolLoopGuard";
import {
  decideTruncationRecovery,
  truncationWarningMessage,
} from "../actions/truncationRecovery";
import { discardIncompleteToolCalls } from "../actions/completeToolCalls";
import { isClearMutationBlocker } from "../actions/isClearMutationBlocker";
import {
  batchIsReadonlyTools,
  requiresMutation,
  softMutationNudgeMessage,
  unfulfilledExecuteNudgeMessage,
} from "../actions/mutationNudge";
import { runV8MutationCritic } from "../actions/mutationCritic";
import {
  buildRejectedMutationRecoveryMessage,
} from "../actions/rejectedMutationRecovery";
import {
  DIAGNOSE_ANSWER_NUDGE_MESSAGE,
  answerLockModelRequestFields,
  toolsOffModelRequestFields,
  primaryToolNameIfUniform,
  shouldLockDiagnoseAnswer,
  shouldNudgeDiagnoseAnswer,
  updateRepeatedReadonlyToolTurns,
} from "../modules/diagnose-answer";
import { prepareTurn } from "./prepareTurn";
import { settleToolBatch } from "./settleTools";

function pickV8ThresholdOverrides(
  raw: V8EngineThresholdsOverrides | Record<string, number> | undefined,
): V8EngineThresholdsOverrides | undefined {
  if (!raw) return undefined;
  const next: V8EngineThresholdsOverrides = {};
  for (const key of Object.keys(V8_ENGINE_THRESHOLDS) as Array<
    keyof typeof V8_ENGINE_THRESHOLDS
  >) {
    const value = raw[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      next[key] = value;
    }
  }
  return Object.keys(next).length > 0 ? next : undefined;
}

export type V8ModelLoopParams = {
  runId: string;
  requestId: string;
  interactionMode: AgentMode;
  llm: LlmPort;
  request: ModelRequest;
  decision: ExecutionDecision;
  messages: ModelMessage[];
  bus: EventBus;
  signal: AbortSignal;
  budget: RunBudgetTracker;
  reasonCodes: AgentReasonCode[];
  warnings: string[];
  toolCache: ToolCallCache;
  changedFiles: string[];
  mutationCheckpointIds: string[];
  dirtyPaths: readonly string[] | undefined;
  pinnedState: RepositoryStateReference | undefined;
  workspaceRoot: string | undefined;
  taskListRef: TaskListRef;
  evidence?: RunEvidence;
  establishedFacts: EstablishedFact[];
  windowPolicy: WindowPolicy;
  /** Seeded from checkpoint when resuming after Continue. */
  continueOverrideCount?: number;
  /** Host / lab overrides for v8 knobs (merged onto band defaults). */
  thresholdOverrides?: V8EngineThresholdsOverrides | Record<string, number>;
  /** Pre-mutation critic mode from steering (default off). */
  criticMode?: SteeringCriticMode;
  understanding?: RequestUnderstandingResult;
  repoBuildStateBefore?: RepoBuildState;
  memoryFacts?: readonly { id: string; content: string }[];
  logVerbosity?: AgentLogVerbosity;
  selectedSkillIds?: readonly string[];
  projectRuleIds?: readonly string[];
  environmentIds?: readonly string[];
  instructionBodies?: import("../internal/system-context").InstructionBodiesByKind;
};

/**
 * Thin model/tool loop with Phase 3 discipline:
 * prepareTurn (compaction/working set), ToolLoopGuard, soft mutation nudge
 * (no evidence spend), rejected-mutation recovery, truncation/reasoning rails.
 */
export async function runV8ModelLoop(
  runtime: AgentEngineRuntime,
  params: V8ModelLoopParams,
): Promise<ToolLoopOutcome> {
  const {
    runId,
    requestId,
    interactionMode,
    llm,
    request,
    messages,
    bus,
    signal,
    budget,
    reasonCodes,
    warnings,
    toolCache,
    changedFiles,
    mutationCheckpointIds,
    dirtyPaths,
    pinnedState,
    workspaceRoot,
    taskListRef,
    evidence,
    establishedFacts,
    windowPolicy,
  } = params;

  let decision = params.decision;
  let answer = "";
  let truncationRecoveriesUsed = 0;
  let reasoningAbortRecoveriesUsed = 0;
  let readOnlyTurnsWithoutMutation = 0;
  let unfulfilledExecuteRecoveries = 0;
  let rejectedMutationRecoveries = 0;
  let emittedLoopPressureWarning = false;
  let emittedLoopCompactionWarning = false;
  let lastPromptCacheClass: PromptCacheClass | undefined;
  let contextEpoch: ContextEpoch | undefined =
    runtime.contextEpochs.get(runId);
  const sessionHistoryArchive = new InMemorySessionHistoryArchive();
  const logVerbosity: AgentLogVerbosity = params.logVerbosity ?? "standard";
  const continueOverrideCount = params.continueOverrideCount ?? 0;
  let forceFinalOnly = false;
  let awaitingAnswerOnly = false;
  let consecutiveSameToolTurns = 0;
  let lastUniformToolName: string | undefined;
  let diagnoseAnswerNudges = 0;
  const mutationNeeded = requiresMutation(decision);
  const vcsHistoryRewrite = decision.reasonCodes.includes("vcs_history_rewrite");
  let gitWriteSucceeded = false;
  const readLedger = new ReadLedger();
  const thresholds = resolveV8LoopPolicyThresholds({
    contextWindowTokens: params.windowPolicy.contextWindowTokens,
    overrides: pickV8ThresholdOverrides(params.thresholdOverrides),
  }).thresholds;
  const mustReadNudgeBudget = { remaining: thresholds.maxMustReadNudges };
  const changeImpactRecommended = decision.reasonCodes.includes(
    "change_impact_recommended",
  );
  const changeImpactGate = {
    required:
      changeImpactRecommended &&
      decision.toolGrant.maximumWorkspaceEffect === "write",
    satisfied: !(
      changeImpactRecommended &&
      decision.toolGrant.maximumWorkspaceEffect === "write"
    ),
  };
  const changeImpactNudgeBudget = {
    remaining: changeImpactGate.required
      ? thresholds.maxChangeImpactNudges
      : 0,
  };
  const loopFileReads = createLoopFileReadTracker();
  const criticMode: SteeringCriticMode = params.criticMode ?? "off";
  const toolLoopGuard = new ToolLoopGuard({
    softIdenticalLimit: thresholds.toolLoopSoftIdentical,
    hardIdenticalLimit: thresholds.toolLoopHardIdentical,
    identicalCallAndResultLimit: thresholds.toolLoopIdenticalCallAndResult,
    forcedRejectLimit: thresholds.toolLoopForcedRejectLimit,
  });

  const offerContinue = (
    wallReason: "exploration_stall" | "unfulfilled_execute" | "budget_exhausted",
    partialAnswer: string,
  ): ToolLoopOutcome => {
    const offered = tryOfferBudgetWallContinue({
      wallReason,
      messages,
      toolCache,
      changedFiles,
      mutationCheckpointIds,
      answer: partialAnswer,
      decision,
      continueOverrideCount,
      maxContinueOverrides: thresholds.maxContinueOverrides,
      taskList: taskListRef.current,
      mutationRequired: mutationNeeded,
    });
    if (offered) return offered;
    reasonCodes.push("stall_continue_override_capped");
    return {
      kind: "failed",
      answer: partialAnswer || undefined,
      extraReasons: [],
      error: {
        code:
          wallReason === "unfulfilled_execute"
            ? "no_mutation_performed"
            : "execution_failed",
        message:
          wallReason === "unfulfilled_execute"
            ? "Required mutation was not performed before the continue override cap."
            : "Tool loop exhausted without a recoverable Continue path.",
      },
    };
  };

  while (true) {
    if (signal.aborted) {
      return { kind: "cancelled" };
    }
    if (!budget.canStartModelCall()) {
      return offerContinue(
        "budget_exhausted",
        answer || "Model call budget exhausted.",
      );
    }

    budget.recordModelCall();
    budget.recordLoopIteration();
    runtime.emitStage(bus, runId, "model_running", "started");

    const offerTools =
      !forceFinalOnly &&
      !awaitingAnswerOnly &&
      !toolLoopGuard.isForcingFinalResponse() &&
      decision.toolGrant.allowedTools.length > 0;
    const toolFields = awaitingAnswerOnly
      ? answerLockModelRequestFields(request.tools)
      : offerTools
        ? { tools: request.tools }
        : toolsOffModelRequestFields();
    const baseRequest: ModelRequest = {
      ...request,
      ...toolFields,
    };

    const prepared = prepareTurn({
      runtime,
      runId,
      bus,
      request: baseRequest,
      messages,
      budget,
      windowPolicy,
      taskListRef,
      grantPathScopes: decision.toolGrant.pathScopes,
      mutationBudget: decision.toolGrant.mutationBudget,
      repoBuildStateBefore: params.repoBuildStateBefore,
      memoryFacts: params.memoryFacts,
      establishedFacts,
      reasonCodes,
      warnings,
      logVerbosity,
      lastPromptCacheClass,
      emittedLoopPressureWarning,
      emittedLoopCompactionWarning,
      contextEpoch,
      decisionRoute: decision.route,
      decisionPlanningDepth: decision.planningDepth,
      selectedSkillIds: params.selectedSkillIds,
      projectRuleIds: params.projectRuleIds,
      environmentIds: params.environmentIds,
      instructionBodies: params.instructionBodies,
      memoryIds: params.memoryFacts?.map((fact) => fact.id) ?? [],
      sessionHistoryArchive,
    });
    emittedLoopPressureWarning = prepared.emittedLoopPressureWarning;
    emittedLoopCompactionWarning = prepared.emittedLoopCompactionWarning;
    lastPromptCacheClass = prepared.promptCacheClass;
    contextEpoch = prepared.contextEpoch;
    if (prepared.contextEpoch) {
      runtime.contextEpochs.set(runId, prepared.contextEpoch);
      const store = runtime.deps.contextEpochStore;
      if (store) {
        void store.save(prepared.contextEpoch).catch(() => {
          /* best-effort; checkpoint remains authoritative */
        });
      }
    }

    const turn = await consumeModelTurn(runtime, {
      llm,
      request: prepared.turnRequest,
      runId,
      signal,
      bus,
      maxReasoningCharsWithoutProgress:
        thresholds.maxReasoningCharsWithoutProgress,
    });

    if (turn.kind === "cancelled") {
      return { kind: "cancelled" };
    }
    if (turn.kind === "failed") {
      reasonCodes.push("provider_failed");
      return {
        kind: "failed",
        answer: turn.content || answer || undefined,
        extraReasons: [],
        error: { code: turn.errorCode, message: turn.errorMessage },
      };
    }

    if (turn.usage) {
      budget.addUsage(turn.usage);
    }

    const truncated = turn.finishReason === "length";
    const stickyMutable = estimateStickyMutableChars(
      prepared.turnRequest.messages,
    );
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
      preservePrefix: prepared.preservePrefix,
      promptCacheClass: prepared.promptCacheClass,
      stickyInputChars: stickyMutable.stickyChars,
      mutableInputChars: stickyMutable.mutableChars,
      compactionPressure: prepared.compaction.pressure,
      at: runtime.isoNow(),
    });

    const { complete: toolCalls, discardedCount } = discardIncompleteToolCalls(
      turn.toolCalls,
    );
    if (discardedCount > 0) {
      warnings.push(
        `Discarded ${discardedCount} incomplete truncated tool call(s).`,
      );
    }

    let softNudgeAfterSettle = false;
    if (toolCalls.length > 0) {
      const callDecision = toolLoopGuard.observeCalls(
        toolCalls.map((call) => ({
          name: call.name,
          arguments: call.arguments,
        })),
      );

      if (callDecision.type === "reject") {
        warnings.push(
          `Identical tool batch rejected (${callDecision.violationCount} after force-final).`,
        );
        messages.push({
          role: "assistant",
          content: turn.content,
          toolCalls,
        });
        messages.push({
          role: "user",
          content: forceFinalToolLoopMessage(callDecision.violationCount),
        });
        runtime.emitStage(bus, runId, "model_running", "completed", [
          "model_completed",
        ]);
        if (callDecision.exhausted) {
          return offerContinue("exploration_stall", turn.content || answer);
        }
        forceFinalOnly = true;
        continue;
      }

      if (callDecision.type === "force_final") {
        warnings.push(
          `Tool loop force-final after ${callDecision.repeatCount} identical batches.`,
        );
        forceFinalOnly = true;
        messages.push({
          role: "assistant",
          content: turn.content,
          toolCalls,
        });
        messages.push({
          role: "user",
          content: forceFinalToolLoopMessage(callDecision.repeatCount),
        });
        runtime.emitStage(bus, runId, "model_running", "completed", [
          "model_completed",
        ]);
        continue;
      }

      if (callDecision.type === "soft") {
        softNudgeAfterSettle = true;
        warnings.push(
          `Soft tool-loop nudge after ${callDecision.repeatCount} identical batches.`,
        );
      }
    }

    const recovery = decideTruncationRecovery({
      finishReason: turn.finishReason,
      reasoningBudgetExceeded: turn.reasoningBudgetExceeded === true,
      hasToolCalls: toolCalls.length > 0,
      incompleteToolCalls: discardedCount > 0 && toolCalls.length === 0,
      truncationRecoveriesUsed,
      maxTruncationRecoveries: thresholds.maxTruncationRecoveries,
      reasoningAbortRecoveriesUsed,
      maxReasoningAbortRecoveries: thresholds.maxReasoningAbortRecoveries,
      requireMutation: mutationNeeded,
    });

    if (recovery.resetCounter) {
      truncationRecoveriesUsed = 0;
      reasoningAbortRecoveriesUsed = 0;
    }

    if (recovery.kind === "reasoning_abort") {
      if (recovery.countReasoningAbort) {
        reasoningAbortRecoveriesUsed += 1;
      }
      reasonCodes.push("reasoning_progress_budget_exceeded");
      if (recovery.shouldRecover) {
        warnings.push(
          truncationWarningMessage({ reasoningBudgetExceeded: true }),
        );
        reasonCodes.push("model_completed");
        messages.push({
          role: "assistant",
          content: turn.content || "(reasoning only — no tools or answer)",
        });
        if (recovery.message) {
          messages.push({ role: "user", content: recovery.message });
        }
        runtime.emitStage(bus, runId, "model_running", "completed", [
          "model_completed",
          "reasoning_progress_budget_exceeded",
        ]);
        continue;
      }
      // Soft recoveries exhausted — ask the host to Continue rather than
      // thrashing more reasoning-only turns.
      return offerContinue(
        mutationNeeded ? "unfulfilled_execute" : "exploration_stall",
        turn.content || answer,
      );
    }

    if (
      recovery.shouldRecover &&
      (recovery.kind === "text_continuation" || recovery.kind === "tool_call")
    ) {
      truncationRecoveriesUsed += 1;
      reasonCodes.push("output_truncation_recovered");
      warnings.push(truncationWarningMessage({}));
      messages.push({
        role: "assistant",
        content: turn.content,
        ...(toolCalls.length > 0 ? { toolCalls } : {}),
      });
      if (recovery.message) {
        messages.push({ role: "user", content: recovery.message });
      }
      runtime.emitStage(bus, runId, "model_running", "completed", [
        "model_completed",
        "output_truncated",
        "output_truncation_recovered",
      ]);
      continue;
    }

    reasonCodes.push("model_completed");
    if (truncated && turn.reasoningBudgetExceeded !== true) {
      reasonCodes.push("output_truncated");
    }
    runtime.emitStage(bus, runId, "model_running", "completed", [
      "model_completed",
      ...(truncated && turn.reasoningBudgetExceeded !== true
        ? (["output_truncated"] as const)
        : []),
    ]);

    if (toolCalls.length > 0) {
      truncationRecoveriesUsed = 0;

      const critic = runV8MutationCritic({
        decision,
        toolCalls,
        turnContent: turn.content,
        mode: criticMode,
        understanding: params.understanding,
      });
      if (critic.result.shadowWouldBlock) {
        reasonCodes.push("mutation_critic_shadow_block");
        warnings.push(
          `Mutation critic (shadow) would block: ${critic.result.reasons.join(" ")}`,
        );
        runtime.emit(bus, {
          type: "warning",
          runId,
          message: `Mutation critic shadow: ${critic.result.reasons[0] ?? "would block"}`,
          at: runtime.isoNow(),
        });
      }
      if (critic.kind === "revise") {
        reasonCodes.push("mutation_critic_revise");
        if (
          critic.result.narrowToPaths &&
          critic.result.narrowToPaths.length > 0 &&
          runtime.deps.decision.narrow
        ) {
          decision = runtime.deps.decision.narrow({
            previous: decision,
            discoveredPaths: critic.result.narrowToPaths,
          });
          reasonCodes.push("grant_narrowed");
        }
        warnings.push(
          `Mutation critic revise: ${critic.result.reasons.join(" ")}`,
        );
        messages.push({
          role: "assistant",
          content: turn.content,
          toolCalls,
        });
        messages.push({ role: "user", content: critic.message });
        continue;
      }
      if (critic.kind === "stop") {
        reasonCodes.push("mutation_critic_stop");
        warnings.push(
          `Mutation critic stop: ${critic.result.reasons.join(" ")}`,
        );
        messages.push({
          role: "assistant",
          content: turn.content,
          toolCalls,
        });
        messages.push({ role: "user", content: critic.message });
        continue;
      }
      if (
        critic.kind === "pass" &&
        !critic.result.shadowWouldBlock &&
        criticMode !== "off"
      ) {
        reasonCodes.push("mutation_critic_pass");
      }

      const settled = await settleToolBatch({
        runtime,
        runId,
        requestId,
        interactionMode,
        bus,
        signal,
        decision,
        toolCalls,
        turnContent: turn.content,
        messages,
        toolCache,
        readLedger,
        budget,
        warnings,
        reasonCodes,
        dirtyPaths,
        pinnedState,
        workspaceRoot,
        changedFiles,
        mutationCheckpointIds,
        taskListRef,
        evidence,
        establishedFacts,
        windowPolicy,
        answer,
        toolLoopGuard,
        mustReadNudgeBudget,
        changeImpactGate,
        changeImpactNudgeBudget,
        loopFileReads,
      });
      if (settled.kind === "return") {
        return settled.outcome;
      }
      decision = settled.decision;

      if (softNudgeAfterSettle) {
        messages.push({
          role: "user",
          content: softToolLoopNudgeMessage(thresholds.toolLoopSoftIdentical),
        });
      }

      if (settled.stats.succeededMutating || settled.stats.succeededGitWrite) {
        if (settled.stats.succeededGitWrite) {
          gitWriteSucceeded = true;
        }
        readOnlyTurnsWithoutMutation = 0;
        unfulfilledExecuteRecoveries = 0;
        rejectedMutationRecoveries = 0;
        consecutiveSameToolTurns = 0;
        lastUniformToolName = undefined;
      } else if (
        mutationNeeded &&
        changedFiles.length === 0 &&
        !gitWriteSucceeded &&
        settled.stats.rejectedMutation &&
        rejectedMutationRecoveries < thresholds.maxRejectedMutationRecoveries &&
        budget.canStartModelCall()
      ) {
        rejectedMutationRecoveries += 1;
        const rejected = settled.stats.rejectedMutation;
        const maxTargetedDiscoveryToolCalls =
          decision.toolGrant.mutationBudget?.maxUniqueFilesPerCall ??
          thresholds.preferredBatchSize;
        reasonCodes.push("tool_failed");
        warnings.push(
          `Mutation tool ${rejected.toolName} ${rejected.status}; requesting a corrected edit.`,
        );
        messages.push({
          role: "user",
          content: buildRejectedMutationRecoveryMessage({
            ...rejected,
            maxTargetedDiscoveryToolCalls,
            defaultPreferredBatchSize: thresholds.preferredBatchSize,
          }),
        });
      } else if (mutationNeeded && batchIsReadonlyTools(toolCalls)) {
        readOnlyTurnsWithoutMutation += 1;
        if (
          readOnlyTurnsWithoutMutation >=
          thresholds.maxReadOnlyTurnsBeforeMutationNudge
        ) {
          warnings.push(
            `Soft mutation nudge after ${readOnlyTurnsWithoutMutation} read-only turns.`,
          );
          messages.push({
            role: "user",
            content: softMutationNudgeMessage(readOnlyTurnsWithoutMutation, {
              vcsHistoryRewrite,
            }),
          });
          readOnlyTurnsWithoutMutation = 0;
        }
      } else if (!mutationNeeded && settled.stats.readonlyOnly) {
        const uniform = primaryToolNameIfUniform(toolCalls);
        const next = updateRepeatedReadonlyToolTurns({
          previousToolName: lastUniformToolName,
          previousCount: consecutiveSameToolTurns,
          turnToolName: uniform,
        });
        lastUniformToolName = next.toolName;
        consecutiveSameToolTurns = next.count;

        if (
          shouldNudgeDiagnoseAnswer({
            mutationRequired: false,
            consecutiveSameToolTurns,
            maxRepeatedReadonlyToolTurnsBeforeAnswerNudge:
              thresholds.maxRepeatedReadonlyToolTurnsBeforeAnswerNudge,
            diagnoseAnswerNudges,
            maxDiagnoseAnswerNudges: thresholds.maxDiagnoseAnswerNudges,
          }) &&
          budget.canStartModelCall()
        ) {
          diagnoseAnswerNudges += 1;
          reasonCodes.push("incomplete_answer_recovered");
          messages.push({
            role: "user",
            content: DIAGNOSE_ANSWER_NUDGE_MESSAGE,
          });
          warnings.push(
            `Repeated ${uniform ?? "tool"} turns without an answer; requesting a final response.`,
          );
        } else if (
          shouldLockDiagnoseAnswer({
            mutationRequired: false,
            consecutiveSameToolTurns,
            maxRepeatedReadonlyToolTurnsBeforeAnswerNudge:
              thresholds.maxRepeatedReadonlyToolTurnsBeforeAnswerNudge,
            diagnoseAnswerNudges,
            maxDiagnoseAnswerNudges: thresholds.maxDiagnoseAnswerNudges,
          })
        ) {
          awaitingAnswerOnly = true;
          reasonCodes.push("incomplete_answer_recovered");
          messages.push({
            role: "user",
            content: DIAGNOSE_ANSWER_NUDGE_MESSAGE,
          });
          warnings.push(
            "Stripped tools after repeated identical diagnostic turns; next turn must answer.",
          );
        }
      } else if (!mutationNeeded) {
        consecutiveSameToolTurns = 0;
        lastUniformToolName = undefined;
      }

      if (toolLoopGuard.isForcingFinalResponse()) {
        forceFinalOnly = true;
        messages.push({
          role: "user",
          content: forceFinalToolLoopMessage(
            thresholds.toolLoopIdenticalCallAndResult,
          ),
        });
      }

      continue;
    }

    answer = turn.content;
    messages.push({ role: "assistant", content: turn.content });

    const mutationStillNeeded =
      mutationNeeded && changedFiles.length === 0 && !gitWriteSucceeded;

    if (mutationStillNeeded) {
      // Honest "cannot edit" / grant/policy blockers must not open Continue.
      if (isClearMutationBlocker(answer)) {
        reasonCodes.push("answer_produced");
        return {
          kind: "completed",
          answer,
          changedFiles,
          mutationCheckpointIds,
          messages,
          toolCache,
          decision,
        };
      }
      unfulfilledExecuteRecoveries += 1;
      if (
        unfulfilledExecuteRecoveries <=
        thresholds.maxUnfulfilledExecuteRecoveries
      ) {
        warnings.push("Unfulfilled execute: nudging for apply_patch.");
        messages.push({
          role: "user",
          content: unfulfilledExecuteNudgeMessage({ vcsHistoryRewrite }),
        });
        continue;
      }
      return offerContinue("unfulfilled_execute", answer);
    }

    if (changedFiles.length > 0 || gitWriteSucceeded) {
      reasonCodes.push("mutation_applied");
    }
    if (answer.trim().length > 0) {
      reasonCodes.push("answer_produced");
    }

    return {
      kind: "completed",
      answer,
      changedFiles,
      mutationCheckpointIds,
      messages,
      toolCache,
      decision,
    };
  }
}
