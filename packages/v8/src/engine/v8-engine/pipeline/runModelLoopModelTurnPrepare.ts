/**
 * Build tool-lock request fields, prepareTurn, and persist context epoch.
 */
import type { ExecutionDecision } from "../../../modules/decision-policy";
import type {
  ModelMessage,
  ModelRequest,
} from "../../../modules/model-gateway";
import type { WindowPolicy } from "../../../modules/window-budget";
import type { RepoBuildState } from "../../../modules/verification";

import type { EstablishedFact } from "../actions";
import type { PromptCacheClass } from "../actions/resolvePromptCacheClass";
import type { AgentReasonCode } from "../contracts";
import type { ContextEpoch } from "../internal/context-epoch";
import type { AgentLogVerbosity } from "../internal/logVerbosity";
import type { RunBudgetTracker } from "../internal/RunBudget";
import type { InMemorySessionHistoryArchive } from "../internal/session-history";
import type { InstructionBodiesByKind } from "../internal/system-context";
import type { TaskListRef } from "../internal/taskListRuntime";
import type { EventBus } from "../internal/EventBus";
import {
  answerLockModelRequestFields,
  toolsOffModelRequestFields,
} from "../modules/diagnose-answer";
import { mutateLockModelRequestFields } from "../modules/mutate-readiness";
import type { ToolLoopGuard } from "../modules/tool-loop-guard";
import { prepareTurn } from "./prepareTurn";
import type { AgentEngineRuntime } from "./runtime";

export type PreparedModelLoopTurn = {
  turnRequest: ModelRequest;
  preservePrefix: boolean;
  promptCacheClass: PromptCacheClass;
  compaction: Awaited<ReturnType<typeof prepareTurn>>["compaction"];
  memoryFacts: { id: string; content: string }[] | undefined;
  emittedLoopPressureWarning: boolean;
  emittedLoopCompactionWarning: boolean;
  contextEpoch: ContextEpoch | undefined;
};

export async function prepareModelLoopModelTurn(params: {
  runtime: AgentEngineRuntime;
  bus: EventBus;
  runId: string;
  signal: AbortSignal;
  request: ModelRequest;
  messages: ModelMessage[];
  budget: RunBudgetTracker;
  windowPolicy: WindowPolicy;
  taskListRef: TaskListRef;
  decision: ExecutionDecision;
  forceFinalOnly: boolean;
  awaitingAnswerOnly: boolean;
  awaitingMutateOnly: boolean;
  mutateLockAllowTargetedReads: boolean;
  toolLoopGuard: ToolLoopGuard;
  reasonCodes: AgentReasonCode[];
  warnings: string[];
  logVerbosity: AgentLogVerbosity;
  lastPromptCacheClass: PromptCacheClass | undefined;
  emittedLoopPressureWarning: boolean;
  emittedLoopCompactionWarning: boolean;
  contextEpoch: ContextEpoch | undefined;
  memoryFacts: { id: string; content: string }[] | undefined;
  memoryQuery?: string;
  memoryWorkspaceId?: string;
  memoryFileTargets?: readonly string[];
  establishedFacts: EstablishedFact[];
  repoBuildStateBefore?: RepoBuildState;
  selectedSkillIds?: readonly string[];
  projectRuleIds?: readonly string[];
  environmentIds?: readonly string[];
  instructionBodies?: InstructionBodiesByKind;
  sessionHistoryArchive: InMemorySessionHistoryArchive;
}): Promise<PreparedModelLoopTurn> {
  const {
    runtime,
    bus,
    runId,
    signal,
    request,
    messages,
    budget,
    windowPolicy,
    taskListRef,
    decision,
    forceFinalOnly,
    awaitingAnswerOnly,
    awaitingMutateOnly,
    mutateLockAllowTargetedReads,
    toolLoopGuard,
    reasonCodes,
    warnings,
    logVerbosity,
    sessionHistoryArchive,
  } = params;

  let memoryFacts = params.memoryFacts;
  let emittedLoopPressureWarning = params.emittedLoopPressureWarning;
  let emittedLoopCompactionWarning = params.emittedLoopCompactionWarning;
  let contextEpoch = params.contextEpoch;

  const offerTools =
    !forceFinalOnly &&
    !awaitingAnswerOnly &&
    !awaitingMutateOnly &&
    !toolLoopGuard.isForcingFinalResponse() &&
    decision.toolGrant.allowedTools.length > 0;
  const toolFields = awaitingAnswerOnly
    ? answerLockModelRequestFields(request.tools)
    : awaitingMutateOnly
      ? mutateLockModelRequestFields(request.tools, {
          allowTargetedReads: mutateLockAllowTargetedReads,
        })
      : offerTools
        ? { tools: request.tools }
        : toolsOffModelRequestFields();
  const baseRequest: ModelRequest = {
    ...request,
    ...toolFields,
  };

  const prepared = await prepareTurn({
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
    memoryFacts,
    memoryQuery: params.memoryQuery,
    memoryWorkspaceId: params.memoryWorkspaceId,
    memoryFileTargets: params.memoryFileTargets,
    abortSignal: signal,
    establishedFacts: params.establishedFacts,
    reasonCodes,
    warnings,
    logVerbosity,
    lastPromptCacheClass: params.lastPromptCacheClass,
    emittedLoopPressureWarning,
    emittedLoopCompactionWarning,
    contextEpoch,
    decisionRoute: decision.route,
    decisionPlanningDepth: decision.planningDepth,
    selectedSkillIds: params.selectedSkillIds,
    projectRuleIds: params.projectRuleIds,
    environmentIds: params.environmentIds,
    instructionBodies: params.instructionBodies,
    memoryIds: memoryFacts?.map((fact) => fact.id) ?? [],
    sessionHistoryArchive,
  });
  if (prepared.memoryFacts) {
    memoryFacts = [...prepared.memoryFacts];
  }
  emittedLoopPressureWarning = prepared.emittedLoopPressureWarning;
  emittedLoopCompactionWarning = prepared.emittedLoopCompactionWarning;
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

  return {
    turnRequest: prepared.turnRequest,
    preservePrefix: prepared.preservePrefix,
    promptCacheClass: prepared.promptCacheClass,
    compaction: prepared.compaction,
    memoryFacts,
    emittedLoopPressureWarning,
    emittedLoopCompactionWarning,
    contextEpoch,
  };
}
