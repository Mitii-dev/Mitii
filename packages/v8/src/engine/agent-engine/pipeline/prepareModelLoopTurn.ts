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
  CONTEXT_EPOCH_SOURCE_KEYS,
  extractBaselineSystemText,
  initializeContextEpoch,
  markContextEpochForReplacement,
  reconcileContextEpoch,
  replaceContextEpoch,
  type ContextEpoch,
} from "../internal/context-epoch";
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
 * Stub completed-task bodies, resolve cache-class compaction, upsert the
 * trailing working set, and clamp per-turn output tokens.
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

  const contextEpoch = admitContextEpoch({
    runId,
    messages,
    previous: params.contextEpoch,
    compactionApplied: compaction.compacted,
    reasonCodes,
    nowMs: Date.now(),
    decisionRoute: params.decisionRoute,
    decisionPlanningDepth: params.decisionPlanningDepth,
    selectedSkillIds: params.selectedSkillIds,
  });

  upsertTrailingWorkingSet(messages, {
    taskList: params.taskListRef.current,
    mutationBudget: params.mutationBudget,
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

function admitContextEpoch(params: {
  runId: string;
  messages: ModelMessage[];
  previous: ContextEpoch | undefined;
  compactionApplied: boolean;
  reasonCodes: AgentReasonCode[];
  nowMs: number;
  decisionRoute?: string;
  decisionPlanningDepth?: string;
  selectedSkillIds?: readonly string[];
}): ContextEpoch | undefined {
  const baseline = extractBaselineSystemText(params.messages);
  if (!baseline) {
    return params.previous;
  }

  const sources: Record<string, string> = {
    [CONTEXT_EPOCH_SOURCE_KEYS.baselineSystem]: baseline,
    [CONTEXT_EPOCH_SOURCE_KEYS.route]: params.decisionRoute ?? "",
    [CONTEXT_EPOCH_SOURCE_KEYS.planningDepth]:
      params.decisionPlanningDepth ?? "",
    [CONTEXT_EPOCH_SOURCE_KEYS.skills]: (params.selectedSkillIds ?? []).join(
      ",",
    ),
  };

  if (!params.previous) {
    const epoch = initializeContextEpoch({
      runId: params.runId,
      baselineSystemText: baseline,
      sources,
      nowMs: params.nowMs,
    });
    params.reasonCodes.push("context_epoch_initialized");
    return epoch;
  }

  let epoch = params.previous;
  if (params.compactionApplied) {
    epoch = markContextEpochForReplacement(epoch);
    if (!params.reasonCodes.includes("context_epoch_replace_requested")) {
      params.reasonCodes.push("context_epoch_replace_requested");
    }
  }

  const reconciled = reconcileContextEpoch({
    epoch,
    observedSources: sources,
    baselineAvailable: true,
  });

  switch (reconciled.kind) {
    case "unchanged":
      if (!params.reasonCodes.includes("context_epoch_unchanged")) {
        params.reasonCodes.push("context_epoch_unchanged");
      }
      return reconciled.epoch;
    case "updated":
      params.reasonCodes.push("context_epoch_updated");
      return reconciled.epoch;
    case "replace_blocked":
      params.reasonCodes.push("context_epoch_replace_blocked");
      return reconciled.epoch;
    case "replace_ready": {
      const replaced = replaceContextEpoch({
        previous: reconciled.epoch,
        baselineSystemText: baseline,
        sources,
        nowMs: params.nowMs,
      });
      params.reasonCodes.push("context_epoch_replaced");
      return replaced;
    }
  }
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
