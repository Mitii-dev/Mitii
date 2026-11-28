import type { MutationBudget } from "../../../modules/decision-policy";
import type { ModelMessage, ModelRequest } from "../../../modules/model-gateway";
import type { WindowPolicy } from "../../../modules/window-budget";
import type { RepoBuildState } from "../../../modules/verification";

import { buildPreflightDiagnosticRepairInstruction } from "../actions";
import { preflightDiagnosticsForUserRequest } from "../modules/user-path-priority";
import type { EstablishedFact } from "../actions";
import type { PromptCacheClass } from "../actions/resolvePromptCacheClass";
import type { ModelLoopCompactionResult } from "../actions/compactModelLoopMessages";
import type { AgentReasonCode } from "../contracts";
import type { EventBus } from "../internal/EventBus";
import type { RunBudgetTracker } from "../internal/RunBudget";
import type { ContextEpoch } from "../internal/context-epoch";
import type { InMemorySessionHistoryArchive } from "../internal/session-history";
import type { AgentLogVerbosity } from "../internal/logVerbosity";
import {
  shouldRemindTodoUpdate,
  type TaskListRef,
} from "../internal/taskListRuntime";
import { upsertTrailingWorkingSet } from "../internal/workingSetRuntime";

import type { AgentEngineRuntime } from "./runtime";
import { applyContextEpochAdmission } from "./turnContextEpoch";
import { applySessionHistoryHybrid } from "./turnSessionHistory";
import { prepareModelLoopCompaction } from "./prepareModelLoopCompaction";
import { clampTurnOutput } from "./prepareModelLoopTurnClamp";

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
    reasonCodes,
    logVerbosity,
  } = params;

  const compacted = await prepareModelLoopCompaction({
    runtime,
    runId,
    bus,
    request: params.request,
    messages,
    budget: params.budget,
    windowPolicy: params.windowPolicy,
    taskListRef: params.taskListRef,
    memoryFacts: params.memoryFacts,
    memoryQuery: params.memoryQuery,
    memoryWorkspaceId: params.memoryWorkspaceId,
    memoryFileTargets: params.memoryFileTargets,
    abortSignal: params.abortSignal,
    establishedFacts: params.establishedFacts,
    reasonCodes,
    warnings: params.warnings,
    logVerbosity,
    lastPromptCacheClass: params.lastPromptCacheClass,
    emittedLoopPressureWarning: params.emittedLoopPressureWarning,
    emittedLoopCompactionWarning: params.emittedLoopCompactionWarning,
  });

  const {
    promptCacheClass,
    preservePrefix,
    compaction,
    memoryFacts,
    emittedLoopPressureWarning,
    emittedLoopCompactionWarning,
    usageSnapshot,
  } = compacted;

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
      params.memoryIds ?? memoryFacts?.map((fact) => fact.id) ?? [],
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
