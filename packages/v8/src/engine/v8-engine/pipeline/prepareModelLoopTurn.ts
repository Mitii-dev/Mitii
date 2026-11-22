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
  refreshMemoryFactsForCompaction,
  resolveCompactionPressure,
  resolveCompactionThresholds,
  resolvePromptCacheClass,
  shouldPreserveModelLoopPrefix,
  stubToolResultsForCompletedPaths,
} from "../actions";
import { preflightDiagnosticsForUserRequest } from "../modules/user-path-priority";
import type { EstablishedFact } from "../actions";
import type { PromptCacheClass } from "../actions/resolvePromptCacheClass";
import type { ModelLoopCompactionResult } from "../actions/compactModelLoopMessages";
import type { AgentReasonCode } from "../contracts";
import { EventBus } from "../internal/EventBus";
import type { RunBudgetTracker } from "../internal/RunBudget";
import type { ContextEpoch } from "../internal/context-epoch";
import type { InMemorySessionHistoryArchive } from "../internal/session-history";
import {
  logVerbosityAtLeast,
  type AgentLogVerbosity,
} from "../internal/logVerbosity";
import {
  collectCompletedTaskPaths,
  shouldRemindTodoUpdate,
  type TaskListRef,
} from "../internal/taskListRuntime";
import { upsertTrailingWorkingSet } from "../internal/workingSetRuntime";

import type { AgentEngineRuntime } from "./runtime";
import { applyContextEpochAdmission } from "./turnContextEpoch";
import { applySessionHistoryHybrid } from "./turnSessionHistory";

export interface PrepareModelLoopTurnResult {
  turnRequest: ModelRequest;
  preservePrefix: boolean;
  promptCacheClass: PromptCacheClass;
  compaction: ModelLoopCompactionResult;
  emittedLoopPressureWarning: boolean;
  emittedLoopCompactionWarning: boolean;
  contextEpoch: ContextEpoch | undefined;
  /** Facts used for this turn's compact reinject (may be freshly retrieved). */
  memoryFacts?: readonly { id: string; content: string }[];
}

/**
 * Stub completed-task bodies, resolve cache-class compaction, archive dropped
 * Session History (dual-store), hybrid-retrieve into conversationShare
 * budget, upsert working set, admit Context Epoch, clamp output tokens.
 */
export async function prepareModelLoopTurn(params: {
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
  /** Query + workspace for fresh Memory retrieve under auto/hard pressure. */
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
  contextEpoch?: ContextEpoch;
  decisionRoute?: string;
  decisionPlanningDepth?: string;
  selectedSkillIds?: readonly string[];
  projectRuleIds?: readonly string[];
  environmentIds?: readonly string[];
  /** Optional bodies for epoch mid-update content deltas (no memory). */
  instructionBodies?: import("../internal/system-context").InstructionBodiesByKind;
  memoryIds?: readonly string[];
  /** When true, working-set copy demands an immediate mutation. */
  mutationLocked?: boolean;
  /** Durable archive for turns dropped from model projection. */
  sessionHistoryArchive?: InMemorySessionHistoryArchive;
}): Promise<PrepareModelLoopTurnResult> {
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
    instructionBodies: params.instructionBodies,
    memoryIds:
      params.memoryIds ??
      memoryFacts?.map((fact) => fact.id) ??
      [],
  });

  upsertTrailingWorkingSet(messages, {
    taskList: params.taskListRef.current,
    mutationBudget: params.mutationBudget,
    mutationLocked: params.mutationLocked === true,
    remindTodoUpdate: shouldRemindTodoUpdate({
      taskList: params.taskListRef.current,
      lastUpdatedAtModelCall: params.taskListRef.lastUpdatedAtModelCall,
      currentModelCall: usageSnapshot.modelCalls,
    }),
    preflightDiagnostics: (() => {
      const raw = params.repoBuildStateBefore?.diagnostics ?? [];
      // Deferred unless user invited fix-build or cited overlapping paths.
      const scoped = preflightDiagnosticsForUserRequest(
        raw,
        params.memoryQuery,
      );
      if (scoped.length === 0) {
        return undefined;
      }
      return buildPreflightDiagnosticRepairInstruction({
        diagnostics: [...scoped],
        totalErrorCount: scoped.length,
        pathScopes: params.grantPathScopes,
        maxDiagnostics: Math.max(
          params.windowPolicy.planning.maxDiagnosticSteps,
          scoped.length >= 20 ? 24 : 0,
        ),
        maxChars: Math.min(
          Math.max(
            params.windowPolicy.compaction.establishedFactReinjectChars,
            scoped.length >= 20 ? 4_800 : 2_400,
          ),
          6_000,
        ),
      });
    })(),
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
    memoryFacts,
  };
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
    // Answer-lock / no-tool turns drop the tool-loop ceiling; still must not
    // exceed the provider's advertised max (DeepSeek/Ollama reject otherwise).
    providerMaximumOutputTokens:
      runtime.deps.llm.capabilities.maximumOutputTokens,
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
