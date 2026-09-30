import type { MutationBudget } from "../../../modules/decision-policy";
import type { ModelMessage, ModelRequest } from "../../../modules/model-gateway";
import type { WindowPolicy } from "../../../modules/window-budget";
import type { RepoBuildState } from "../../../modules/verification";

import type { EstablishedFact } from "../actions";
import type { PromptCacheClass } from "../actions/resolvePromptCacheClass";
import type { ModelLoopCompactionResult } from "../actions/compactModelLoopMessages";
import type { AgentReasonCode } from "../contracts";
import { EventBus } from "../internal/EventBus";
import type { RunBudgetTracker } from "../internal/RunBudget";
import type { ContextEpoch } from "../internal/context-epoch";
import type { InMemorySessionHistoryArchive } from "../internal/session-history";
import type { AgentLogVerbosity } from "../internal/logVerbosity";
import type { TaskListRef } from "../internal/taskListRuntime";
import { prepareModelLoopTurn } from "./prepareModelLoopTurn";
import type { AgentEngineRuntime } from "./runtime";

export type PrepareTurnResult = {
  turnRequest: ModelRequest;
  preservePrefix: boolean;
  promptCacheClass: PromptCacheClass;
  compaction: ModelLoopCompactionResult;
  emittedLoopPressureWarning: boolean;
  emittedLoopCompactionWarning: boolean;
  contextEpoch: ContextEpoch | undefined;
};

export type PrepareTurnParams = {
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
  sessionHistoryArchive?: InMemorySessionHistoryArchive;
};

/**
 * Prepare one model turn: stub completed-task bodies, compact under the
 * window policy, hybrid session-history recall, upsert working set, admit
 * context epoch, clamp output tokens.
 *
 * Never arms mutation lock. Preflight diagnostics may appear in the working
 * set as capture only — they do not force a repair lock.
 */
export function prepareTurn(params: PrepareTurnParams): PrepareTurnResult {
  return prepareModelLoopTurn({
    ...params,
    mutationLocked: false,
  });
}
