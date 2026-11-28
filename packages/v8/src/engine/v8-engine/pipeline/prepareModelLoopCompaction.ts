/**
 * Stub completed paths, resolve cache class, refresh memory, compact messages.
 */
import type { ModelMessage, ModelRequest } from "../../../modules/model-gateway";
import type { WindowPolicy } from "../../../modules/window-budget";

import {
  calculateLoopInputBudgetTokens,
  compactModelLoopMessagesFromWindowPolicy,
  estimateModelMessagesTokens,
  refreshMemoryFactsForCompaction,
  resolveCompactionPressure,
  resolveCompactionThresholds,
  resolvePromptCacheClass,
  shouldPreserveModelLoopPrefix,
  stubToolResultsForCompletedPaths,
} from "../actions";
import type { EstablishedFact } from "../actions";
import type { PromptCacheClass } from "../actions/resolvePromptCacheClass";
import type { ModelLoopCompactionResult } from "../actions/compactModelLoopMessages";
import type { AgentReasonCode } from "../contracts";
import type { EventBus } from "../internal/EventBus";
import type { RunBudgetTracker } from "../internal/RunBudget";
import {
  logVerbosityAtLeast,
  type AgentLogVerbosity,
} from "../internal/logVerbosity";
import { collectCompletedTaskPaths, type TaskListRef } from "../internal/taskListRuntime";
import type { AgentEngineRuntime } from "./runtime";

export type PrepareCompactionResult = {
  promptCacheClass: PromptCacheClass;
  preservePrefix: boolean;
  compaction: ModelLoopCompactionResult;
  memoryFacts: { id: string; content: string }[] | undefined;
  emittedLoopPressureWarning: boolean;
  emittedLoopCompactionWarning: boolean;
  usageSnapshot: ReturnType<RunBudgetTracker["snapshot"]>;
};

export async function prepareModelLoopCompaction(params: {
  runtime: AgentEngineRuntime;
  runId: string;
  bus: EventBus;
  request: ModelRequest;
  messages: ModelMessage[];
  budget: RunBudgetTracker;
  windowPolicy: WindowPolicy;
  taskListRef: TaskListRef;
  memoryFacts?: readonly { id: string; content: string }[];
  memoryQuery?: string;
  memoryWorkspaceId?: string;
  memoryFileTargets?: readonly string[];
  abortSignal?: AbortSignal;
  establishedFacts: EstablishedFact[];
  reasonCodes: AgentReasonCode[];
  warnings: string[];
  logVerbosity: AgentLogVerbosity;
  lastPromptCacheClass?: PromptCacheClass;
  emittedLoopPressureWarning: boolean;
  emittedLoopCompactionWarning: boolean;
}): Promise<PrepareCompactionResult> {
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

  let memoryFacts = params.memoryFacts
    ? [...params.memoryFacts]
    : undefined;
  const preCompactUsed = estimateModelMessagesTokens(
    messages,
    runtime.tokenEstimator,
  );
  const preCompactThresholds = resolveCompactionThresholds({
    budgetTokens: loopInputBudgetTokens,
    warnRatio: params.windowPolicy.compaction.warnRatio,
    autoRatio: params.windowPolicy.compaction.autoRatio,
    hardRatio: params.windowPolicy.compaction.hardRatio,
    autoMaxTokens: params.windowPolicy.compaction.autoMaxTokens,
    hardMaxTokens: params.windowPolicy.compaction.hardMaxTokens,
    preservePrefix,
  });
  const preCompactPressure = resolveCompactionPressure({
    usedTokens: preCompactUsed,
    thresholds: preCompactThresholds,
  });
  if (preCompactPressure === "auto" || preCompactPressure === "hard") {
    const refresh = await refreshMemoryFactsForCompaction({
      memory: runtime.deps.memory,
      workspaceId: params.memoryWorkspaceId,
      query: params.memoryQuery,
      maxChars: params.windowPolicy.compaction.memoryReinjectChars,
      previous: memoryFacts ?? [],
      pressure: preCompactPressure,
      now: runtime.isoNow(),
      fileTargets: params.memoryFileTargets,
      signal: params.abortSignal,
    });
    if (refresh.refreshed) {
      memoryFacts = refresh.facts;
      reasonCodes.push("memory_refreshed_for_compaction");
      runtime.emit(bus, {
        type: "warning",
        runId,
        message: `Refreshed ${refresh.facts.length} memory fact(s) before ${preCompactPressure} compaction reinject.`,
        code: "memory_refreshed_for_compaction",
        ...(logVerbosityAtLeast(logVerbosity, "standard")
          ? {
              data: {
                pressure: preCompactPressure,
                factCount: refresh.facts.length,
                maxChars: params.windowPolicy.compaction.memoryReinjectChars,
              },
            }
          : {}),
        at: runtime.isoNow(),
      });
    }
  }

  const compaction = compactModelLoopMessagesFromWindowPolicy({
    messages,
    estimator: runtime.tokenEstimator,
    budgetTokens: loopInputBudgetTokens,
    compaction: params.windowPolicy.compaction,
    memoryFacts,
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
      if (compaction.reinjectedMemory) {
        reasonCodes.push("memory_reinjected");
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
                stagesApplied: compaction.stagesApplied.join(","),
                reinjectedMemory: compaction.reinjectedMemory,
                memoryFactCount: memoryFacts?.length ?? 0,
              },
            }
          : {}),
        at: runtime.isoNow(),
      });
    }
  }

  return {
    promptCacheClass,
    preservePrefix,
    compaction,
    memoryFacts,
    emittedLoopPressureWarning,
    emittedLoopCompactionWarning,
    usageSnapshot,
  };
}
