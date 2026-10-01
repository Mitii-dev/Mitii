import type { MutationBudget } from "../../../modules/decision-policy";
import type { ModelMessage, ModelRequest } from "../../../modules/model-gateway";
import type { WindowPolicy } from "../../../modules/window-budget";
import type { RepoBuildState } from "../../../modules/verification";

import type { EstablishedFact } from "../actions";
import type { PromptCacheClass } from "../actions/resolvePromptCacheClass";
import type { AgentReasonCode } from "../contracts";
import { EventBus } from "../internal/EventBus";
import type { RunBudgetTracker } from "../internal/RunBudget";
import type { ContextEpoch } from "../internal/context-epoch";
import type { InMemorySessionHistoryArchive } from "../internal/session-history";
import type { AgentLogVerbosity } from "../internal/logVerbosity";
import type { TaskListRef } from "../internal/taskListRuntime";
import {
  prepareModelLoopTurn,
  type PrepareModelLoopTurnResult,
} from "./prepareModelLoopTurn";
import type { AgentEngineRuntime } from "./runtime";

export type PrepareTurnResult = PrepareModelLoopTurnResult;

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
  instructionBodies?: import("../internal/system-context").InstructionBodiesByKind;
  memoryIds?: readonly string[];
  sessionHistoryArchive?: InMemorySessionHistoryArchive;
};

/**
 * Prepare one model turn: stub completed-task bodies, compact under the
 * window policy (with optional fresh Memory retrieve on auto/hard), hybrid
 * session-history recall, upsert working set, admit context epoch, clamp
 * output tokens.
 *
 * Never arms mutation lock. Preflight diagnostics may appear in the working
 * set as capture only — they do not force a repair lock.
 */
export async function prepareTurn(
  params: PrepareTurnParams,
): Promise<PrepareTurnResult> {
  return prepareModelLoopTurn({
    ...params,
    mutationLocked: false,
  });
}
