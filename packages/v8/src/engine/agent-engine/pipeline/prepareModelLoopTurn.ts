import type { MutationBudget } from "../../../modules/decision-policy";
import type { ModelMessage, ModelRequest } from "../../../modules/model-gateway";
import type { TokenEstimatorPort } from "../../../modules/prompt-construction";
import {
  resolveGenerationCeiling,
} from "../../../modules/window-budget";
import type { WindowPolicy } from "../../../modules/window-budget";
import type { RepoBuildState } from "../../../modules/verification";

import {
  buildPreflightDiagnosticRepairInstruction,
  calculateLoopInputBudgetTokens,
  clampTurnMaximumOutputTokens,
  compactModelLoopMessagesFromWindowPolicy,
  estimateModelMessagesTokens,
  resolvePromptCacheClass,
  shouldPreserveModelLoopPrefix,
  stubToolResultsForCompletedPaths,
} from "../actions";
import type { EstablishedFact } from "../actions";
import type { PromptCacheClass } from "../actions/resolvePromptCacheClass";
import type { ModelLoopCompactionResult } from "../actions/compactModelLoopMessages";
import type { AgentReasonCode } from "../contracts";
import { EventBus } from "../internal/EventBus";
import type { RunBudgetTracker } from "../internal/RunBudget";
import {
  admitContextEpoch,
  appendMidConversationSystemMessage,
  baselinePrefixMatches,
  pinBaselineSystemMessage,
  stripMidConversationSystemMessages,
  type ContextEpoch,
} from "../internal/context-epoch";
import {
  isSessionHistoryCheckpointContent,
  looksReferentialSessionQuery,
  resolveSessionHistoryProjectionBudgetChars,
  retrieveSessionHistory,
  type InMemorySessionHistoryArchive,
} from "../internal/session-history";
import {
  logVerbosityAtLeast,
  type AgentLogVerbosity,
} from "../internal/logVerbosity";
import {
  collectCompletedTaskPaths,
  type TaskListRef,
} from "../internal/taskListRuntime";
import { upsertTrailingWorkingSet } from "../internal/workingSetRuntime";

import type { AgentEngineRuntime } from "./runtime";

export interface PrepareModelLoopTurnResult {
  turnRequest: ModelRequest;
  preservePrefix: boolean;
  promptCacheClass: PromptCacheClass;
  compaction: ModelLoopCompactionResult;
  emittedLoopPressureWarning: boolean;
  emittedLoopCompactionWarning: boolean;
  contextEpoch: ContextEpoch | undefined;
}

/**
 * Stub completed-task bodies, resolve cache-class compaction, archive dropped
 * Session History (OpenCode dual-store), hybrid-retrieve into conversationShare
 * budget, upsert working set, admit Context Epoch, clamp output tokens.
 */
export function prepareModelLoopTurn(params: {
  runtime: AgentEngineRuntime;
  runId: string;
  bus: EventBus;
  request: ModelRequest;
  messages: ModelMessage[];
  budget: RunBudgetTracker;
  windowPolicy: WindowPolicy;
  taskListRef: TaskListRef;
  grantPathScopes: readonly string[];
  mutationBudget?: MutationBudget;
  repoBuildStateBefore?: RepoBuildState;
  memoryFacts?: readonly { id: string; content: string }[];
  establishedFacts: EstablishedFact[];
  reasonCodes: AgentReasonCode[];
  warnings: string[];
  logVerbosity: AgentLogVerbosity;
  lastPromptCacheClass?: PromptCacheClass;
  emittedLoopPressureWarning: boolean;
  emittedLoopCompactionWarning: boolean;
  contextEpoch?: ContextEpoch;
  decisionRoute?: string;
  decisionPlanningDepth?: string;
  selectedSkillIds?: readonly string[];
  projectRuleIds?: readonly string[];
  environmentIds?: readonly string[];
  memoryIds?: readonly string[];
  /** When true, working-set copy demands an immediate mutation. */
  mutationLocked?: boolean;
  /** Durable archive for turns dropped from model projection. */
  sessionHistoryArchive?: InMemorySessionHistoryArchive;
}): PrepareModelLoopTurnResult {
  const {
    runtime,
    runId,
    bus,
    messages,
    budget,
    reasonCodes,
    warnings,
    logVerbosity,
  } = params;

  let emittedLoopPressureWarning = params.emittedLoopPressureWarning;
  let emittedLoopCompactionWarning = params.emittedLoopCompactionWarning;

  const loopInputBudgetTokens = calculateLoopInputBudgetTokens({
    request: params.request,
    windowPolicy: params.windowPolicy,
    estimator: runtime.tokenEstimator,
  });
  const completedTaskPaths = collectCompletedTaskPaths(
    params.taskListRef.current,
  );
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

  const usageSnapshot = budget.snapshot();
  const promptCacheClass = resolvePromptCacheClass({
    supportsPromptCaching: runtime.deps.llm.capabilities.supportsPromptCaching,
    cacheHitTokens: usageSnapshot.cacheHitTokens,
    cacheMissTokens: usageSnapshot.cacheMissTokens,
    modelCalls: Math.max(0, usageSnapshot.modelCalls - 1),
  });
  if (promptCacheClass !== params.lastPromptCacheClass) {
    reasonCodes.push(
      promptCacheClass === "no_cache"
        ? "prompt_cache_class_no_cache"
        : "prompt_cache_class_prompt_cache",
    );
  }
  const preservePrefix = shouldPreserveModelLoopPrefix(promptCacheClass);
  const compaction = compactModelLoopMessagesFromWindowPolicy({
    messages,
    estimator: runtime.tokenEstimator,
    budgetTokens: loopInputBudgetTokens,
    compaction: params.windowPolicy.compaction,
    memoryFacts: params.memoryFacts,
    establishedFacts: params.establishedFacts,
    preservePrefix,
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
      message: "Model loop context is approaching the compaction threshold.",
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
        compaction.droppedMessages.length > 0
          ? `archived-${compaction.droppedMessages.length}-turns`
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
                droppedMessages: compaction.droppedMessages.length,
              },
            }
          : {}),
        at: runtime.isoNow(),
      });
    }
  }

  applySessionHistoryHybrid({
    runId,
    messages,
    archive: params.sessionHistoryArchive,
    droppedMessages: compaction.droppedMessages,
    windowPolicy: params.windowPolicy,
    reasonCodes,
    nowMs: Date.now(),
  });

  const contextEpoch = applyContextEpochAdmission({
    runId,
    messages,
    previous: params.contextEpoch,
    compactionApplied: compaction.compacted,
    reasonCodes,
    nowMs: Date.now(),
    decisionRoute: params.decisionRoute,
    decisionPlanningDepth: params.decisionPlanningDepth,
    selectedSkillIds: params.selectedSkillIds,
    projectRuleIds: params.projectRuleIds,
    environmentIds: params.environmentIds,
    memoryIds:
      params.memoryIds ??
      params.memoryFacts?.map((fact) => fact.id) ??
      [],
  });

  upsertTrailingWorkingSet(messages, {
    taskList: params.taskListRef.current,
    mutationBudget: params.mutationBudget,
    mutationLocked: params.mutationLocked === true,
    preflightDiagnostics: buildPreflightDiagnosticRepairInstruction({
      diagnostics: params.repoBuildStateBefore?.diagnostics ?? [],
      totalErrorCount: params.repoBuildStateBefore?.summary.errorCount ?? 0,
      pathScopes: params.grantPathScopes,
      maxDiagnostics: params.windowPolicy.planning.maxDiagnosticSteps,
      maxChars: Math.min(
        params.windowPolicy.compaction.establishedFactReinjectChars,
        2_400,
      ),
    }),
    establishedFacts: params.establishedFacts,
    maxEstablishedFactChars:
      params.windowPolicy.compaction.establishedFactReinjectChars,
  });

  const turnRequest: ModelRequest = {
    ...params.request,
    messages: [...messages],
  };
  clampTurnOutput(runtime, {
    turnRequest,
    windowPolicy: params.windowPolicy,
    estimator: runtime.tokenEstimator,
    runId,
    bus,
    logVerbosity,
  });

  return {
    turnRequest,
    preservePrefix,
    promptCacheClass,
    compaction,
    emittedLoopPressureWarning,
    emittedLoopCompactionWarning,
    contextEpoch,
  };
}

/**
 * OpenCode dual-store cutover + Mitii hybrid recall under conversationShare.
 *
 * 1. Archive dropped turns (durable; leave model projection).
 * 2. Query = latest non-system user message.
 * 3. After drop OR referential follow-up: RRF hybrid retrieve → upsert checkpoint.
 */
function applySessionHistoryHybrid(params: {
  runId: string;
  messages: ModelMessage[];
  archive: InMemorySessionHistoryArchive | undefined;
  droppedMessages: readonly ModelMessage[];
  windowPolicy: WindowPolicy;
  reasonCodes: AgentReasonCode[];
  nowMs: number;
}): void {
  const archive = params.archive;
  if (!archive) {
    return;
  }

  if (params.droppedMessages.length > 0) {
    const archived = archive.archiveDroppedMessages({
      dropped: params.droppedMessages,
      nowMs: params.nowMs,
      runId: params.runId,
    });
    if (archived.length > 0) {
      params.reasonCodes.push("session_history_archived");
    }
  }

  if (archive.size() === 0) {
    return;
  }

  const query = extractLatestUserQuery(params.messages);
  if (!query) {
    return;
  }

  const justDropped = params.droppedMessages.length > 0;
  const referential = looksReferentialSessionQuery(query);
  if (!justDropped && !referential) {
    return;
  }

  const budgetChars = resolveSessionHistoryProjectionBudgetChars({
    conversationTokens: params.windowPolicy.sections.conversationTokens,
    droppedTurnSummaryChars:
      params.windowPolicy.compaction.droppedTurnSummaryChars,
  });

  const retrieved = retrieveSessionHistory({
    archive: archive.list(),
    query,
    budgetChars,
    force: justDropped,
  });

  if (!retrieved.projectionText || retrieved.hits.length === 0) {
    return;
  }

  params.reasonCodes.push("session_history_hybrid_retrieved");
  upsertSessionHistoryCheckpoint(params.messages, retrieved.projectionText);
  params.reasonCodes.push("session_history_projection_upserted");
}

function extractLatestUserQuery(
  messages: readonly ModelMessage[],
): string | undefined {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (
      message?.role === "user" &&
      typeof message.content === "string" &&
      message.content.trim().length > 0 &&
      !isSessionHistoryCheckpointContent(message.content) &&
      !message.content.includes("<working_set") &&
      !message.content.startsWith("[compacted prior context")
    ) {
      return message.content;
    }
  }
  return undefined;
}

function upsertSessionHistoryCheckpoint(
  messages: ModelMessage[],
  projectionText: string,
): void {
  const existing = messages.findIndex(
    (message) =>
      message.role === "user" &&
      isSessionHistoryCheckpointContent(message.content),
  );
  if (existing >= 0) {
    messages[existing] = { role: "user", content: projectionText };
    return;
  }
  // Insert after system / mid-conversation system messages (OpenCode: after
  // settlement, before trailing working set which upsertTrailingWorkingSet owns).
  let insertAt = 0;
  while (
    insertAt < messages.length &&
    messages[insertAt]?.role === "system"
  ) {
    insertAt += 1;
  }
  messages.splice(insertAt, 0, { role: "user", content: projectionText });
}

function applyContextEpochAdmission(params: {
  runId: string;
  messages: ModelMessage[];
  previous: ContextEpoch | undefined;
  compactionApplied: boolean;
  reasonCodes: AgentReasonCode[];
  nowMs: number;
  decisionRoute?: string;
  decisionPlanningDepth?: string;
  selectedSkillIds?: readonly string[];
  projectRuleIds?: readonly string[];
  environmentIds?: readonly string[];
  memoryIds?: readonly string[];
}): ContextEpoch | undefined {
  const admitted = admitContextEpoch({
    runId: params.runId,
    messages: params.messages,
    previous: params.previous,
    compactionApplied: params.compactionApplied,
    nowMs: params.nowMs,
    observed: {
      route: params.decisionRoute ?? "",
      planningDepth: params.decisionPlanningDepth ?? "",
      skillIds: params.selectedSkillIds ?? [],
      ruleIds: params.projectRuleIds ?? [],
      environmentIds: params.environmentIds ?? [],
      memoryIds: params.memoryIds ?? [],
    },
  });

  if (!admitted) {
    return params.previous;
  }

  if (params.compactionApplied) {
    if (!params.reasonCodes.includes("context_epoch_replace_requested")) {
      params.reasonCodes.push("context_epoch_replace_requested");
    }
  }

  const isInit = !params.previous;
  if (admitted.stripPriorMidConversation) {
    const removed = stripMidConversationSystemMessages(params.messages);
    if (removed > 0) {
      params.reasonCodes.push("context_epoch_mid_updates_stripped");
    }
    params.reasonCodes.push("context_epoch_replaced");
  } else if (isInit) {
    params.reasonCodes.push("context_epoch_initialized");
  } else if (admitted.midConversationText) {
    params.reasonCodes.push("context_epoch_updated");
    params.reasonCodes.push("context_epoch_mid_update_admitted");
  } else if (admitted.epoch.replacementRequested) {
    params.reasonCodes.push("context_epoch_replace_blocked");
  } else if (!params.reasonCodes.includes("context_epoch_unchanged")) {
    params.reasonCodes.push("context_epoch_unchanged");
  }

  if (admitted.pinBaseline) {
    const pin = pinBaselineSystemMessage(params.messages, admitted.pinBaseline);
    if (pin.rewritten) {
      params.reasonCodes.push("context_epoch_baseline_rewritten");
    } else if (isInit || admitted.stripPriorMidConversation) {
      params.reasonCodes.push("context_epoch_baseline_pinned");
    }
  }

  if (admitted.midConversationText) {
    appendMidConversationSystemMessage(
      params.messages,
      admitted.midConversationText,
    );
  }

  if (
    admitted.epoch &&
    !baselinePrefixMatches(params.messages, admitted.epoch) &&
    !params.reasonCodes.includes("context_cache_prefix_mismatch")
  ) {
    params.reasonCodes.push("context_cache_prefix_mismatch");
  }

  return admitted.epoch;
}

function clampTurnOutput(
  runtime: AgentEngineRuntime,
  params: {
    turnRequest: ModelRequest;
    windowPolicy: WindowPolicy;
    estimator: TokenEstimatorPort;
    runId: string;
    bus: EventBus;
    logVerbosity: AgentLogVerbosity;
  },
): void {
  const { turnRequest, windowPolicy, estimator, runId, bus, logVerbosity } =
    params;
  const usedInputTokens =
    estimateModelMessagesTokens(turnRequest.messages, estimator) +
    (turnRequest.tools && turnRequest.tools.length > 0
      ? estimator.estimate(JSON.stringify(turnRequest.tools))
      : 0);
  const generationCeiling = resolveGenerationCeiling({
    contextWindowTokens: windowPolicy.contextWindowTokens,
    configuredOutputTokens: windowPolicy.maximumOutputTokens,
    reasonCodes: windowPolicy.reasonCodes,
  });
  const leftoverOutputTokens = clampTurnMaximumOutputTokens({
    reservedOutputTokens: generationCeiling,
    contextWindowTokens: windowPolicy.contextWindowTokens,
    usedInputTokens,
    toolLoop: Boolean(turnRequest.tools && turnRequest.tools.length > 0),
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
      message: `Turn output tokens reduced from ${previousOutputTokens} to ${leftoverOutputTokens} to fit leftover context (window ${windowPolicy.contextWindowTokens} − input ~${usedInputTokens}).`,
      code: "output_tokens_clamped",
      data: {
        reservedOutputTokens: generationCeiling,
        clampedOutputTokens: leftoverOutputTokens,
        usedInputTokens,
        contextWindowTokens: windowPolicy.contextWindowTokens,
      },
      at: runtime.isoNow(),
    });
  }
}
