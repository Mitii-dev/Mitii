import type {
  ExecutionDecision,
} from "../../../modules/decision-policy";
import type {
  LlmPort,
  ModelEvent,
  ModelMessage,
  ModelRequest,
  ModelToolCall,
  ModelToolCallDelta,
} from "../../../modules/model-gateway";
import type {
  PlanArtifact,
} from "../../../modules/planning";
import type {
  ProjectDescriptor,
  RepositoryStateReference,
} from "../../../modules/repository-state";
import {
  resolveGenerationCeiling,
} from "../../../modules/window-budget";
import type { WindowPolicy } from "../../../modules/window-budget";
import type {
  RequestUnderstandingResult,
} from "../../../modules/request-understanding";
import type { ToolResult } from "../../tool-runtime";
import type {
  RepoBuildState,
} from "../../../modules/verification";

import {
  assembleToolCalls,
  buildExplorationStallNudge,
  buildIncompleteAnswerRecoveryMessage,
  buildOutputTruncationRecovery,
  buildPreflightDiagnosticRepairInstruction,
  summarizeToolCall,
  applyExplorationSignal,
  calculateLoopInputBudgetTokens,
  clampTurnMaximumOutputTokens,
  compactModelLoopMessages,
  stubToolResultsForCompletedPaths,
  estimateModelMessagesTokens,
  extractCompilerErrorPaths,
  extractOutOfScopePaths,
  isExplorationRereadHeavy,
  createLoopFileReadTracker,
  resetLoopFileReadTracker,
  snapshotLoopFileReads,
  isEmptyAssistantTurn,
  isTransitionalAssistantAnswer,
  compactRecoveredAssistantContent,
  shouldRecoverIncompleteAssistantTurn,
  synthesizeFallbackAnswer,
  resolveLoopTurnOutcome,
  requiresMutationForExecute,
  buildUnfulfilledExecuteRecoveryMessage,
  reservedVerificationRepairModelCalls,
  recoverLeakedToolCallsFromMarkup,
  allowsTargetedDiscoveryAfterRejectedMutation,
  buildRejectedMutationRecoveryMessage,
  buildRejectedToolRecoveryMessage,
  isTargetedDiscoveryAfterRejectedMutation,
  isSuccessfulVerificationToolResult,
  buildStallContinueRationale,
  shouldOfferStallContinue,
} from "../actions";
import type {
  EstablishedFact,
} from "../actions";
import { ToolCallCache } from "../internal/ToolCallCache";
import type {
  AgentReasonCode,
  RunEvidence,
} from "../contracts";
import { EventBus } from "../internal/EventBus";
import { RunBudgetTracker } from "../internal/RunBudget";
import {
  logVerbosityAtLeast,
  type AgentLogVerbosity,
} from "../internal/logVerbosity";
import {
  isUpdateTodosTool,
  upsertTrailingWorkingSet,
  collectCompletedTaskPaths,
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

import {
  DEFAULT_MUTATING_TOOL_NAMES,
  executeOneTool,
  refreshAuthorityAfterTools,
  safeJsonParse,
} from "./executeTool";

export function appendTextContinuation(prefix: string, continuation: string): string {
  const first = prefix.trimEnd();
  const second = continuation.trimStart();
  if (!first) return continuation;
  if (!second) return first;
  return `${first}\n${second}`;
}

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
  let decision = params.decision;
  let grant = decision.toolGrant;
  let selectedSkillIds = [...(params.selectedSkillIds ?? [])];
  let answer = "";
  let truncationRecoveries = 0;
  let incompleteAnswerRecoveries = 0;
  let unfulfilledExecuteRecoveries = 0;
  let pendingTextContinuation = "";
  let emittedLoopPressureWarning = false;
  let emittedLoopCompactionWarning = false;
  let successfulVerificationAfterMutation = false;
  let explorationStallNudges = 0;
  const loopFileReads = createLoopFileReadTracker();
  let rejectedMutationRecoveries = 0;
  const mustReadNudgeBudget = {
    remaining: thresholds.maxMustReadNudges,
  };
  let rejectedToolRecoveries = 0;
  let readOnlyToolTurnsWithoutMutation = 0;
  let readOnlyToolTurnsAfterMutation = 0;
  let afterMutationReadOnlyNudges = 0;
  let awaitingReadOnlyMutationRetry = false;
  let readOnlyMutationRetryAttempts = 0;
  let mutationBlockerAsked = false;
  let awaitingRejectedMutationRetry:
    | {
        allowTargetedDiscovery: boolean;
        targetedDiscoveryToolCallsUsed: number;
        maxTargetedDiscoveryToolCalls: number;
      }
    | undefined;
  const establishedFacts = params.establishedFacts ?? [];
  const isMutationRequired = () =>
    requiresMutationForExecute({
      route: decision.route,
      maximumWorkspaceEffect: grant.maximumWorkspaceEffect,
      primaryTaskIntent:
        params.understanding?.intent.classification.primaryTaskIntent,
      reasonCodes: decision.reasonCodes,
    });
  const changeImpactGate = {
    required:
      decision.reasonCodes.includes("change_impact_recommended") &&
      grant.allowedTools.includes("analyze_change_impact"),
    satisfied: false,
  };

  while (true) {
    if (signal.aborted) {
      return { kind: "cancelled" };
    }

    const exhausted = budget.isExhausted();
    if (exhausted) {
      return {
        kind: "budget_exhausted",
        answer: answer || undefined,
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
          answer,
          changedFiles,
          mutationCheckpointIds,
          messages,
          toolCache,
          decision,
        };
      }
      return {
        kind: "budget_exhausted",
        answer: answer || undefined,
        message: "Model call budget exhausted.",
        changedFiles,
        mutationCheckpointIds,
      };
    }

    budget.recordLoopIteration();
    budget.recordModelCall();
    runtime.emitStage(bus, runId, "model_running", "started");

    const loopInputBudgetTokens = calculateLoopInputBudgetTokens({
      request: params.request,
      windowPolicy: params.windowPolicy,
      estimator: runtime.tokenEstimator,
    });
    const completedTaskPaths = collectCompletedTaskPaths(taskListRef.current);
    if (completedTaskPaths.length > 0) {
      const stubbed = stubToolResultsForCompletedPaths({
        messages,
        paths: completedTaskPaths,
        maxChars: params.windowPolicy.compaction.compactedToolResultChars,
      });
      if (stubbed.stubbed) {
        messages.splice(0, messages.length, ...stubbed.messages);
        reasonCodes.push("completed_task_results_stubbed");
      }
    }
    const compaction = compactModelLoopMessages({
      messages,
      estimator: runtime.tokenEstimator,
      budgetTokens: loopInputBudgetTokens,
      memoryFacts: params.memoryFacts,
      establishedFacts,
      maxEstablishedFactReinjectChars:
        params.windowPolicy.compaction.establishedFactReinjectChars,
      maxMemoryReinjectChars:
        params.windowPolicy.compaction.memoryReinjectChars,
      recentToolMessagesToKeepFull:
        params.windowPolicy.compaction.keepRecentToolResults,
      compactedToolResultChars:
        params.windowPolicy.compaction.compactedToolResultChars,
      compactedToolArgumentChars:
        params.windowPolicy.compaction.compactedToolArgumentChars,
      droppedTurnSummaryChars:
        params.windowPolicy.compaction.droppedTurnSummaryChars,
      warnRatio: params.windowPolicy.compaction.warnRatio,
      autoRatio: params.windowPolicy.compaction.autoRatio,
      hardRatio: params.windowPolicy.compaction.hardRatio,
      autoMaxTokens: params.windowPolicy.compaction.autoMaxTokens,
      hardMaxTokens: params.windowPolicy.compaction.hardMaxTokens,
      preservePrefix: true,
      skipEstablishedFactsReinject: true,
    });
    if (
      compaction.pressure === "warn" &&
      !emittedLoopPressureWarning &&
      !compaction.compacted
    ) {
      emittedLoopPressureWarning = true;
      runtime.emit(bus, {
        type: "warning",
        runId,
        message:
          "Model loop context is approaching the compaction threshold.",
        code: "compaction_pressure_warn",
        ...(logVerbosityAtLeast(logVerbosity, "standard")
          ? {
              data: {
                usedTokens: compaction.usedTokens,
                warnTokens: compaction.thresholds.warnTokens,
                autoTokens: compaction.thresholds.autoTokens,
                hardTokens: compaction.thresholds.hardTokens,
              },
            }
          : {}),
        at: runtime.isoNow(),
      });
    }
    if (compaction.compacted) {
      messages.splice(0, messages.length, ...compaction.messages);
      if (!emittedLoopCompactionWarning) {
        emittedLoopCompactionWarning = true;
        const extras = [
          compaction.summarizedDroppedTurns ? "summarized-dropped-turns" : null,
          compaction.reinjectedMemory ? "memory-reinjected" : null,
          compaction.reinjectedEstablishedFacts
            ? "established-facts-reinjected"
            : null,
        ].filter(Boolean);
        if (compaction.reinjectedEstablishedFacts) {
          reasonCodes.push("established_facts_reinjected");
        }
        warnings.push(
          "Compacted previous tool call history to keep follow-up model calls within the context budget.",
        );
        runtime.emit(bus, {
          type: "warning",
          runId,
          message: `Compacted previous tool call history before the next model call (pressure=${compaction.pressure}${
            extras.length > 0 ? `; ${extras.join(", ")}` : ""
          }).`,
          code: "compaction_applied",
          ...(logVerbosityAtLeast(logVerbosity, "standard")
            ? {
                data: {
                  pressure: compaction.pressure,
                  usedTokens: compaction.usedTokens,
                  hardTokens: compaction.thresholds.hardTokens,
                  stillOverHardCeiling:
                    compaction.usedTokens > compaction.thresholds.hardTokens,
                },
              }
            : {}),
          at: runtime.isoNow(),
        });
      }
    }

    upsertTrailingWorkingSet(messages, {
      taskList: taskListRef.current,
      mutationBudget: grant.mutationBudget,
      preflightDiagnostics: buildPreflightDiagnosticRepairInstruction({
        diagnostics: params.repoBuildStateBefore?.diagnostics ?? [],
        totalErrorCount:
          params.repoBuildStateBefore?.summary.errorCount ?? 0,
        pathScopes: grant.pathScopes,
        maxDiagnostics: params.windowPolicy.planning.maxDiagnosticSteps,
        maxChars: Math.min(
          params.windowPolicy.compaction.establishedFactReinjectChars,
          2_400,
        ),
      }),
      establishedFacts,
      maxEstablishedFactChars:
        params.windowPolicy.compaction.establishedFactReinjectChars,
    });

    const turnRequest: ModelRequest = {
      ...params.request,
      messages: [...messages],
    };
    const usedInputTokens =
      estimateModelMessagesTokens(turnRequest.messages, runtime.tokenEstimator) +
      (turnRequest.tools && turnRequest.tools.length > 0
        ? runtime.tokenEstimator.estimate(JSON.stringify(turnRequest.tools))
        : 0);
    const generationCeiling = resolveGenerationCeiling({
      contextWindowTokens: params.windowPolicy.contextWindowTokens,
      configuredOutputTokens: params.windowPolicy.maximumOutputTokens,
      reasonCodes: params.windowPolicy.reasonCodes,
    });
    const leftoverOutputTokens = clampTurnMaximumOutputTokens({
      reservedOutputTokens: generationCeiling,
      contextWindowTokens: params.windowPolicy.contextWindowTokens,
      usedInputTokens,
    });
    const previousOutputTokens =
      turnRequest.maximumOutputTokens ?? generationCeiling;
    turnRequest.maximumOutputTokens = leftoverOutputTokens;
    if (
      leftoverOutputTokens < previousOutputTokens &&
      logVerbosityAtLeast(logVerbosity, "standard")
    ) {
      runtime.emit(bus, {
        type: "warning",
        runId,
        message: `Turn output tokens reduced from ${previousOutputTokens} to ${leftoverOutputTokens} because leftover context was smaller than the generation ceiling.`,
        code: "output_tokens_clamped",
        data: {
          reservedOutputTokens: generationCeiling,
          clampedOutputTokens: leftoverOutputTokens,
          usedInputTokens,
          contextWindowTokens: params.windowPolicy.contextWindowTokens,
        },
        at: runtime.isoNow(),
      });
    }

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
        answer: turn.content || answer || undefined,
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

    const recovery = buildOutputTruncationRecovery({
      finishReason: turn.finishReason,
      content: turn.content,
      toolCalls: turn.toolCalls,
      mutationBudget: grant.mutationBudget,
      recoveryAttempt: truncationRecoveries,
      requireMutation: requiresMutationForExecute({
        route: decision.route,
        maximumWorkspaceEffect: grant.maximumWorkspaceEffect,
        primaryTaskIntent:
          params.understanding?.intent.classification.primaryTaskIntent,
        reasonCodes: decision.reasonCodes,
      }),
      thresholds,
    });

    if (recovery?.shouldRecover) {
      truncationRecoveries += 1;
      reasonCodes.push("output_truncation_recovered");
      if (recovery.recoveryKind === "text_continuation") {
        pendingTextContinuation = appendTextContinuation(
          pendingTextContinuation,
          recovery.assistantContent,
        );
        answer = pendingTextContinuation;
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
      if (turn.content.length > 0) {
        const turnAnswer = truncated
          ? `${turn.content}\n\n…(output truncated — token limit reached)`
          : turn.content;
        if (pendingTextContinuation.length > 0) {
          answer = appendTextContinuation(
            pendingTextContinuation,
            turnAnswer,
          );
          if (!truncated) {
            pendingTextContinuation = "";
          }
        } else {
          answer = turnAnswer;
        }
      }

      const incompleteAssistantTurn = shouldRecoverIncompleteAssistantTurn({
        content: turn.content,
        toolCallCount: 0,
        changedFileCount: changedFiles.length,
        fileReadCalls: budget.snapshot().fileReadCalls,
      });
      const loopOutcome = resolveLoopTurnOutcome({
        route: decision.route,
        maximumWorkspaceEffect: grant.maximumWorkspaceEffect,
        primaryTaskIntent:
          params.understanding?.intent.classification.primaryTaskIntent ?? "",
        toolCallCount: 0,
        changedFileCount: changedFiles.length,
        content: turn.content,
        finishReason: turn.finishReason,
        truncated,
        mutationBudget: grant.mutationBudget,
        reasonCodes: decision.reasonCodes,
        fileReadCalls: budget.snapshot().fileReadCalls,
        recoveries: {
          truncation: truncationRecoveries,
          incompleteAnswer: incompleteAnswerRecoveries,
          unfulfilledExecute: unfulfilledExecuteRecoveries,
        },
        thresholds,
      });
      if (
        incompleteAssistantTurn &&
        successfulVerificationAfterMutation &&
        changedFiles.length > 0
      ) {
        answer = synthesizeFallbackAnswer({
          priorAnswer: answer || turn.content,
          changedFiles,
        });
        reasonCodes.push("incomplete_answer_fallback");
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

      if (
        loopOutcome.disposition === "recover_unfulfilled_execute" &&
        unfulfilledExecuteRecoveries <
          thresholds.maxUnfulfilledExecuteRecoveries &&
        budget.canStartModelCall()
      ) {
        unfulfilledExecuteRecoveries += 1;
        reasonCodes.push("unfulfilled_execute_recovered");
        if (turn.content.trim().length > 0) {
          messages.push({
            role: "assistant",
            content: compactRecoveredAssistantContent(turn.content, thresholds.maxRecoveredAnalysisChars),
          });
        }
        messages.push({
          role: "user",
          content:
            loopOutcome.recoveryMessage ??
            buildUnfulfilledExecuteRecoveryMessage(grant.mutationBudget),
        });
        warnings.push(
          "Execute route produced analysis with no workspace edits; requesting apply_patch.",
        );
        runtime.emit(bus, {
          type: "warning",
          runId,
          message:
            "Model ended on a diagnosis without apply_patch; continuing so the fix can be applied.",
          at: runtime.isoNow(),
        });
        continue;
      }

      if (loopOutcome.reasonCode === "unfulfilled_execute_exhausted") {
        reasonCodes.push("unfulfilled_execute_exhausted");
        return {
          kind: "failed",
          answer: answer || undefined,
          extraReasons: ["unfulfilled_execute_exhausted"],
          error: {
            code: "no_mutation_performed",
            message:
              "The model exhausted the recovery budget without applying workspace edits.",
          },
        };
      } else if (
        (incompleteAssistantTurn ||
          loopOutcome.disposition === "recover_incomplete_narration") &&
        incompleteAnswerRecoveries <
          thresholds.maxIncompleteAnswerRecoveries &&
        budget.canStartModelCall()
      ) {
        incompleteAnswerRecoveries += 1;
        reasonCodes.push("incomplete_answer_recovered");
        const emptyTurn = isEmptyAssistantTurn({
          content: turn.content,
          toolCallCount: 0,
        });
        const recoveryContent =
          loopOutcome.recoveryMessage ??
          buildIncompleteAnswerRecoveryMessage({
            changedFiles,
            emptyTurn,
          });
        if (turn.content.trim().length > 0) {
          messages.push({
            role: "assistant",
            content: compactRecoveredAssistantContent(turn.content, thresholds.maxRecoveredAnalysisChars),
          });
        }
        messages.push({
          role: "user",
          content: recoveryContent,
        });
        warnings.push(
          emptyTurn
            ? "Empty model turn recovered; requesting a final answer or next tool call."
            : "Transitional narration recovered; requesting a final answer or next tool call.",
        );
        runtime.emit(bus, {
          type: "warning",
          runId,
          message: emptyTurn
            ? "Model returned an empty turn; continuing for a complete answer."
            : "Model ended on transitional narration; continuing for a complete answer.",
          at: runtime.isoNow(),
        });
        continue;
      }

      if (
        shouldRecoverIncompleteAssistantTurn({
          content: answer,
          toolCallCount: 0,
          changedFileCount: changedFiles.length,
          fileReadCalls: budget.snapshot().fileReadCalls,
        }) ||
        (changedFiles.length > 0 &&
          (answer.trim().length === 0 ||
            isTransitionalAssistantAnswer(answer)))
      ) {
        answer = synthesizeFallbackAnswer({
          priorAnswer: answer,
          changedFiles,
        });
        reasonCodes.push("incomplete_answer_fallback");
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

    // Tool phase
    const needsWorkspaceTools = toolCalls.some(
      (call) => !isUpdateTodosTool(call.name),
    );
    if (needsWorkspaceTools && !runtime.deps.tools) {
      return {
        kind: "failed",
        answer: answer || undefined,
        extraReasons: ["misconfigured"],
        error: {
          code: "misconfigured",
          message: "Model requested tools but Tool Runtime is not configured.",
        },
      };
    }
    if (needsWorkspaceTools && !workspaceRoot) {
      return {
        kind: "failed",
        answer: answer || undefined,
        extraReasons: ["misconfigured"],
        error: {
          code: "misconfigured",
          message: "Model requested tools but workspaceRoot was not provided.",
        },
      };
    }

    messages.push({
      role: "assistant",
      content: turn.content,
      toolCalls,
    });

    runtime.emitStage(bus, runId, "tool_running", "started");

    // Cap mutation auto-advance to one checklist step per model turn.
    const taskListAutoAdvanceBudget = {
      remaining: runtime.deps.taskListAutoAdvance === true ? 1 : 0,
    };
    let attemptedMutatingTool = false;
    let succeededMutatingTool = false;
    let rejectedMutation:
      | {
          toolName: string;
          status: ToolResult["status"];
          reasonCode?: ToolResult["reasonCode"];
          warnings: readonly string[];
          summary?: string;
        }
      | undefined;
    let successfulToolCount = 0;
    let rejectedToolCount = 0;
    let extraAuthorityPaths: string[] = [];
    let rejectedTool:
      | {
          toolName: string;
          status: ToolResult["status"];
          reasonCode?: ToolResult["reasonCode"];
          warnings: readonly string[];
          summary?: string;
        }
      | undefined;

    for (const toolCall of toolCalls) {
      if (signal.aborted) {
        return { kind: "cancelled" };
      }
      if (!budget.canStartToolCall()) {
        return {
          kind: "budget_exhausted",
          answer: answer || undefined,
          message: "Tool call budget exhausted.",
          changedFiles,
          mutationCheckpointIds,
        };
      }

      const outcome = await executeOneTool(runtime, {
        runId,
        toolCall,
        grant,
        pinnedState,
        workspaceRoot: workspaceRoot ?? ".",
        bus,
        signal,
        toolCache,
        budget,
        warnings,
        reasonCodes,
        dirtyPaths,
        changedFiles,
        mutationCheckpointIds,
        approvalToken: undefined,
        taskListRef,
        taskListAutoAdvance: runtime.deps.taskListAutoAdvance === true,
        taskListAutoAdvanceBudget,
        mutatingToolNames: DEFAULT_MUTATING_TOOL_NAMES,
        changeImpactGate,
      evidence,
      establishedFacts,
      windowPolicy: params.windowPolicy,
      loopFileReads,
      mustReadNudgeBudget,
      plan: params.plan,
    });

      if (outcome.kind === "approval_required") {
        const approvalId = runtime.deps.idGenerator.next("appr");
        return {
          kind: "approval_required",
          messages,
          toolCache,
          pendingApproval: {
            approvalId,
            fingerprint: outcome.fingerprint,
            toolName: outcome.toolName,
            callId: outcome.callId,
            arguments: outcome.arguments,
            paths: outcome.paths,
          },
          changedFiles,
          mutationCheckpointIds,
          answer: answer || undefined,
          decision,
        };
      }

      messages.push(outcome.message);
      const result = toolCache.get(toolCall.id);
      const mutatingTool = DEFAULT_MUTATING_TOOL_NAMES.has(toolCall.name);
      if (mutatingTool) {
        attemptedMutatingTool = true;
      }
      if (result?.status === "succeeded") {
        successfulToolCount += 1;
        if (mutatingTool) {
          succeededMutatingTool = true;
        }
      } else if (result) {
        rejectedToolCount += 1;
        rejectedTool = {
          toolName: toolCall.name,
          status: result.status,
          reasonCode: result.reasonCode,
          warnings: result.warnings,
          summary: summarizeToolCall(
            toolCall.name,
            toolCall.arguments.trim().length === 0
              ? {}
              : safeJsonParse(toolCall.arguments),
          ),
        };
      }
      if (result?.reasonCode === "path_out_of_scope") {
        extraAuthorityPaths.push(...extractOutOfScopePaths(result.warnings));
      }
      if (
        result &&
        (toolCall.name === "run_readonly_command" ||
          toolCall.name === "run_command")
      ) {
        extraAuthorityPaths.push(
          ...extractCompilerErrorPaths(
            result.output,
            result.audit.outputPreview,
          ),
        );
      }
      if (
        mutatingTool &&
        result &&
        result.status !== "succeeded" &&
        result.reasonCode !== "approval_required" &&
        result.reasonCode !== "must_read_incomplete"
      ) {
        rejectedMutation = {
          toolName: toolCall.name,
          status: result.status,
          reasonCode: result.reasonCode,
          warnings: result.warnings,
          summary: summarizeToolCall(
            toolCall.name,
            toolCall.arguments.trim().length === 0
              ? {}
              : safeJsonParse(toolCall.arguments),
          ),
        };
      }
      if (
        changedFiles.length > 0 &&
        result &&
        isSuccessfulVerificationToolResult(toolCall.name, result)
      ) {
        successfulVerificationAfterMutation = true;
      }
    }

    const grantExpansionOutcome = await refreshAuthorityAfterTools(runtime, {
      runId,
      bus,
      reasonCodes,
      warnings,
      messages,
      decisionRef: {
        get: () => decision,
        set: (next) => {
          decision = next;
          grant = next.toolGrant;
        },
      },
      selectedSkillIdsRef: {
        get: () => selectedSkillIds,
        set: (next) => {
          selectedSkillIds = next;
        },
      },
      changedFiles,
      dirtyPaths,
      extraPaths: extraAuthorityPaths,
      understanding: params.understanding,
      skillsQuery: params.skillsQuery,
      mode: params.mode,
      projects: params.projects,
      route: decision.route,
      windowPolicy: params.windowPolicy,
      requiredSkillIds: params.requiredSkillIds,
    });
    if (grantExpansionOutcome.kind === "expansion_required") {
      return {
        kind: "grant_expansion_required",
        messages,
        toolCache,
        extraPaths: grantExpansionOutcome.extraPaths,
        changedFiles,
        mutationCheckpointIds,
        answer: answer || undefined,
        decision,
      };
    }

    reasonCodes.push("tools_executed");
    runtime.emitStage(bus, runId, "tool_running", "completed", [
      "tools_executed",
    ]);

    if (
      isMutationRequired() &&
      changedFiles.length === 0 &&
      awaitingRejectedMutationRetry &&
      !attemptedMutatingTool
    ) {
      if (
        isTargetedDiscoveryAfterRejectedMutation({
          recovery: awaitingRejectedMutationRetry,
          toolCalls,
          successfulToolCount,
          rejectedToolCount,
        })
      ) {
        const used =
          awaitingRejectedMutationRetry.targetedDiscoveryToolCallsUsed +
          toolCalls.length;
        const max =
          awaitingRejectedMutationRetry.maxTargetedDiscoveryToolCalls;
        awaitingRejectedMutationRetry = {
          ...awaitingRejectedMutationRetry,
          targetedDiscoveryToolCallsUsed: used,
          allowTargetedDiscovery: used < max,
        };
        messages.push({
          role: "user",
          content:
            `Use that targeted discovery result to retry the corrected workspace edit now. Targeted stale-patch reads used: ${used}/${max}. Your next turn must call apply_patch/delete_file/move_file or stop with a clear blocker. Only read again if it is one of the exact stale patch files and still within this budget.`,
        });
        warnings.push(
          "Allowed targeted stale-patch discovery after a recoverable rejected mutation.",
        );
        continue;
      }

      reasonCodes.push("tool_failed", "unfulfilled_execute_exhausted");
      return {
        kind: "failed",
        answer: answer || undefined,
        extraReasons: [],
        error: {
          code: "no_mutation_performed",
          message:
            "The model read more files after a rejected mutation instead of retrying the workspace edit.",
        },
      };
    }

    if (
      isMutationRequired() &&
      changedFiles.length === 0 &&
      awaitingReadOnlyMutationRetry &&
      !attemptedMutatingTool
    ) {
      if (mutationBlockerAsked) {
        reasonCodes.push("unfulfilled_execute_exhausted");
        return {
          kind: "failed",
          answer: answer || undefined,
          extraReasons: [],
          error: {
            code: "no_mutation_performed",
            message:
              "The model continued reading after being told to apply the required workspace edit.",
          },
        };
      }

      if (
        readOnlyMutationRetryAttempts <
          thresholds.maxReadOnlyMutationRetryAttempts &&
        budget.canStartModelCall()
      ) {
        readOnlyMutationRetryAttempts += 1;
        reasonCodes.push("unfulfilled_execute_recovered");
        messages.push({
          role: "user",
          content:
            "You read again instead of editing. Your very next turn must call apply_patch/delete_file/move_file with a bounded change, or stop with a clear blocker. No further reads unless you state the blocker first.\n\n" +
            buildUnfulfilledExecuteRecoveryMessage(grant.mutationBudget),
        });
        warnings.push(
          "Model kept reading after the first-mutation nudge; granting another bounded chance before failing the run.",
        );
        continue;
      }

      if (budget.canStartModelCall()) {
        mutationBlockerAsked = true;
        reasonCodes.push("unfulfilled_execute_recovered");
        messages.push({
          role: "user",
          content:
            "Do not call any tools on this turn. Either call apply_patch/delete_file/move_file with a bounded change, or stop with a clear blocker explaining why no workspace edit can fix this (missing config, credentials, external API, or similar). Searching or reading again will fail the run.",
        });
        warnings.push(
          "Read-only drift exhausted; requesting a mutation or an explicit blocker with no further discovery tools.",
        );
        continue;
      }

      reasonCodes.push("unfulfilled_execute_exhausted");
      return {
        kind: "failed",
        answer: answer || undefined,
        extraReasons: [],
        error: {
          code: "no_mutation_performed",
          message:
            "The model continued reading after being told to apply the required workspace edit.",
        },
      };
    }

    if (
      isMutationRequired() &&
      changedFiles.length === 0 &&
      !attemptedMutatingTool &&
      rejectedTool &&
      successfulToolCount === 0 &&
      rejectedToolCount === toolCalls.length
    ) {
      reasonCodes.push("tool_failed");
      if (
        rejectedToolRecoveries <
          thresholds.maxUnfulfilledExecuteRecoveries &&
        budget.canStartModelCall()
      ) {
        rejectedToolRecoveries += 1;
        messages.push({
          role: "user",
          content: buildRejectedToolRecoveryMessage(rejectedTool),
        });
        warnings.push(
          `All requested tools were ${rejectedTool.status}; requesting corrected tool arguments or a patch.`,
        );
        continue;
      }

      reasonCodes.push("unfulfilled_execute_exhausted");
      return {
        kind: "failed",
        answer: answer || undefined,
        extraReasons: [],
        error: {
          code: "no_mutation_performed",
          message:
            "The model repeatedly called rejected tools instead of applying the required workspace edits.",
        },
      };
    }

    if (
      isMutationRequired() &&
      changedFiles.length === 0 &&
      rejectedMutation
    ) {
      reasonCodes.push("tool_failed");
      if (
        rejectedMutationRecoveries <
          thresholds.maxRejectedMutationRecoveries &&
        budget.canStartModelCall()
      ) {
        rejectedMutationRecoveries += 1;
        const maxTargetedDiscoveryToolCalls =
          grant.mutationBudget?.maxUniqueFilesPerCall ??
          thresholds.defaultPreferredBatchSize;
        const allowTargetedDiscovery =
          allowsTargetedDiscoveryAfterRejectedMutation(rejectedMutation);
        awaitingRejectedMutationRetry = {
          allowTargetedDiscovery,
          targetedDiscoveryToolCallsUsed: 0,
          maxTargetedDiscoveryToolCalls,
        };
        messages.push({
          role: "user",
          content: buildRejectedMutationRecoveryMessage({
            ...rejectedMutation,
            maxTargetedDiscoveryToolCalls,
            defaultPreferredBatchSize: thresholds.defaultPreferredBatchSize,
          }),
        });
        warnings.push(
          `Mutation tool ${rejectedMutation.toolName} ${rejectedMutation.status}; requesting a corrected edit.`,
        );
        continue;
      }

      reasonCodes.push("unfulfilled_execute_exhausted");
      return {
        kind: "failed",
        answer: answer || undefined,
        extraReasons: [],
        error: {
          code: "no_mutation_performed",
          message:
            "The model could not apply a valid workspace edit after a rejected mutation attempt.",
        },
      };
    }

    if (attemptedMutatingTool) {
      awaitingRejectedMutationRetry = undefined;
      awaitingReadOnlyMutationRetry = false;
      readOnlyToolTurnsWithoutMutation = 0;
      readOnlyMutationRetryAttempts = 0;
      mutationBlockerAsked = false;
      if (succeededMutatingTool) {
        readOnlyToolTurnsAfterMutation = 0;
        resetLoopFileReadTracker(loopFileReads);
        explorationStallNudges = 0;
      }
    } else if (
      isMutationRequired() &&
      changedFiles.length === 0 &&
      successfulToolCount > 0
    ) {
      readOnlyToolTurnsWithoutMutation += 1;
      if (
        readOnlyToolTurnsWithoutMutation >=
        thresholds.maxReadOnlyToolTurnsBeforeMutationNudge
      ) {
        if (budget.canStartModelCall()) {
          awaitingReadOnlyMutationRetry = true;
          reasonCodes.push("unfulfilled_execute_recovered");
          messages.push({
            role: "user",
            content:
              "You have enough repository context to attempt the requested edit. Stop reading/searching. Your next turn must call apply_patch/delete_file/move_file with a bounded change, or stop with a clear blocker.\n\n" +
              buildUnfulfilledExecuteRecoveryMessage(grant.mutationBudget),
          });
          warnings.push(
            "Execute route spent multiple tool turns reading without edits; requesting the first mutation.",
          );
          continue;
        }

        reasonCodes.push("unfulfilled_execute_exhausted");
        return {
          kind: "failed",
          answer: answer || undefined,
          extraReasons: ["unfulfilled_execute_exhausted"],
          error: {
            code: "no_mutation_performed",
            message:
              "The model repeatedly read files but did not apply the required workspace edits.",
          },
        };
      }
    } else if (
      changedFiles.length > 0 &&
      successfulToolCount > 0 &&
      !attemptedMutatingTool
    ) {
      readOnlyToolTurnsAfterMutation += 1;
      if (
        readOnlyToolTurnsAfterMutation >=
        thresholds.maxReadOnlyToolTurnsAfterMutationNudge
      ) {
        if (
          afterMutationReadOnlyNudges <
            thresholds.maxReadOnlyToolTurnsAfterMutationNudges &&
          budget.canStartModelCall()
        ) {
          afterMutationReadOnlyNudges += 1;
          readOnlyToolTurnsAfterMutation = 0;
          reasonCodes.push("unfulfilled_execute_recovered");
          messages.push({
            role: "user",
            content:
              "Stop globbing/searching. Continue apply_patch for remaining errors, or run typecheck/diagnostics. Do not start a new exploration pass.",
          });
          warnings.push(
            "Execute route spent multiple tool turns reading after mutations; requesting the next patch or verification.",
          );
          continue;
        }

        reasonCodes.push("post_mutation_read_capped");
        warnings.push(
          "Stopped further read-only turns after mutations so verification can use remaining model-call budget.",
        );
        if (
          changedFiles.length > 0 &&
          (answer.trim().length === 0 || isTransitionalAssistantAnswer(answer))
        ) {
          answer = synthesizeFallbackAnswer({
            priorAnswer: answer,
            changedFiles,
          });
          reasonCodes.push("incomplete_answer_fallback");
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

    const loopUsageSnap = snapshotLoopFileReads(loopFileReads);
    if (isExplorationRereadHeavy(loopUsageSnap, thresholds)) {
      applyExplorationSignal(loopUsageSnap, reasonCodes, warnings, thresholds);
      if (
        explorationStallNudges <
        thresholds.maxExplorationStallNudges
      ) {
        explorationStallNudges += 1;
        if (logVerbosityAtLeast(logVerbosity, "verbose")) {
          // Live signal while the run is still in progress — the array
          // pushes above only surface in the terminal result's warnings.
          runtime.emit(bus, {
            type: "warning",
            runId,
            message: `File reads (${loopUsageSnap.fileReadCalls}) substantially exceeded unique paths (${loopUsageSnap.uniqueFilePathsTouched}); nudging the model (attempt ${explorationStallNudges}).`,
            code: "exploration_reread_heavy",
            data: {
              fileReadCalls: loopUsageSnap.fileReadCalls,
              uniqueFilePathsTouched: loopUsageSnap.uniqueFilePathsTouched,
              nudgeAttempt: explorationStallNudges,
            },
            at: runtime.isoNow(),
          });
        }
        messages.push({
          role: "user",
          content: buildExplorationStallNudge(loopUsageSnap, {
            mutationRequired:
              isMutationRequired() && changedFiles.length === 0,
          }),
        });
      } else {
        reasonCodes.push("exploration_stall_broken");
        warnings.push(
          "Stopped the run after repeated file re-reads of the same paths.",
        );
        if (logVerbosityAtLeast(logVerbosity, "standard")) {
          runtime.emit(bus, {
            type: "warning",
            runId,
            message: "Stopped the run after repeated file re-reads of the same paths.",
            code: "exploration_stall_broken",
            data: {
              fileReadCalls: loopUsageSnap.fileReadCalls,
              uniqueFilePathsTouched: loopUsageSnap.uniqueFilePathsTouched,
            },
            at: runtime.isoNow(),
          });
        }
        if (isMutationRequired() && changedFiles.length === 0) {
          return {
            kind: "failed",
            answer: answer || undefined,
            extraReasons: ["unfulfilled_execute_exhausted"],
            error: {
              code: "no_mutation_performed",
              message:
                "The model repeatedly read files but did not apply the required workspace edits.",
            },
          };
        }
        if (
          shouldOfferStallContinue({
            changedFiles,
            taskList: taskListRef.current,
            mutationRequired: isMutationRequired(),
          })
        ) {
          const rationale = buildStallContinueRationale({
            changedFiles,
            taskList: taskListRef.current,
            answer,
            fileReadCalls: loopUsageSnap.fileReadCalls,
            uniqueFilePathsTouched: loopUsageSnap.uniqueFilePathsTouched,
          });
          return {
            kind: "continue_required",
            messages,
            toolCache,
            rationale,
            changedFiles,
            mutationCheckpointIds,
            answer,
            decision,
          };
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
  }
}

export async function consumeModelTurn(
  runtime: AgentEngineRuntime,
  params: {
  llm: LlmPort;
  request: ModelRequest;
  runId: string;
  signal: AbortSignal;
  bus: EventBus;
}): Promise<
  | {
      kind: "completed";
      content: string;
      toolCalls: ModelToolCall[];
      usage?: {
        inputTokens?: number;
        outputTokens?: number;
        cacheHitTokens?: number;
        cacheMissTokens?: number;
      };
      finishReason?: string;
    }
  | { kind: "cancelled" }
  | {
      kind: "failed";
      content: string;
      errorCode: string;
      errorMessage: string;
    }
> {
  const { llm, request, runId, signal, bus } = params;
  const contentParts: string[] = [];
  const reasoningParts: string[] = [];
  const toolDeltas: ModelToolCallDelta[] = [];
  let usage:
    | {
        inputTokens?: number;
        outputTokens?: number;
        cacheHitTokens?: number;
        cacheMissTokens?: number;
      }
    | undefined;
  let finishReason: string | undefined;

  try {
    for await (const event of llm.complete(request, {
      runId,
      abortSignal: signal,
    })) {
      if (signal.aborted) {
        return { kind: "cancelled" };
      }
      forwardModelEvent(runtime, bus, runId, event);

      switch (event.type) {
        case "content_delta":
          contentParts.push(event.content);
          break;
        case "reasoning_delta":
          reasoningParts.push(event.reasoning);
          break;
        case "tool_call_delta":
          toolDeltas.push(...event.toolCalls);
          break;
        case "usage":
          usage = {
            inputTokens: event.usage.inputTokens,
            outputTokens: event.usage.outputTokens,
            cacheHitTokens: event.usage.cacheHitTokens,
            cacheMissTokens: event.usage.cacheMissTokens,
          };
          break;
        case "completed":
          finishReason = event.finishReason;
          if (event.usage) {
            usage = {
              inputTokens: event.usage.inputTokens,
              outputTokens: event.usage.outputTokens,
              cacheHitTokens: event.usage.cacheHitTokens,
              cacheMissTokens: event.usage.cacheMissTokens,
            };
          }
          break;
        case "cancelled":
          return { kind: "cancelled" };
        case "failed":
          return {
            kind: "failed",
            content: contentParts.join("") || reasoningParts.join(""),
            errorCode: event.error.code,
            errorMessage: event.error.message,
          };
        default:
          break;
      }
    }
  } catch (error) {
    if (signal.aborted) {
      return { kind: "cancelled" };
    }
    return {
      kind: "failed",
      content: contentParts.join("") || reasoningParts.join(""),
      errorCode: "provider_failed",
      errorMessage:
        error instanceof Error ? error.message : "Model invocation failed.",
    };
  }

  if (signal.aborted) {
    return { kind: "cancelled" };
  }

  // Some reasoning models stream only into reasoning; fall back so the UI
  // still gets a usable answer.
  const content = contentParts.join("") || reasoningParts.join("");

  return {
    kind: "completed",
    content,
    toolCalls: assembleToolCalls(toolDeltas),
    usage,
    finishReason,
  };
}

export function forwardModelEvent(
  runtime: AgentEngineRuntime,
  
  bus: EventBus,
  runId: string,
  event: ModelEvent,
): void {
  if (event.type === "content_delta") {
    runtime.emit(bus, {
      type: "model_delta",
      runId,
      kind: "content",
      preview: event.content.slice(0, 200),
      at: runtime.isoNow(),
    });
    return;
  }
  if (event.type === "reasoning_delta") {
    runtime.emit(bus, {
      type: "model_delta",
      runId,
      kind: "reasoning",
      preview: event.reasoning.slice(0, 200),
      at: runtime.isoNow(),
    });
    return;
  }
  if (event.type === "tool_call_delta") {
    const name = event.toolCalls.find((c) => c.name)?.name;
    runtime.emit(bus, {
      type: "model_delta",
      runId,
      kind: "tool_call",
      preview: name,
      at: runtime.isoNow(),
    });
  }
}
