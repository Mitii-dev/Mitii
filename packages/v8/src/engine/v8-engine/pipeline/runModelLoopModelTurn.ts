import type { ExecutionDecision } from "../../../modules/decision-policy";
import type {
  LlmPort,
  ModelMessage,
  ModelRequest,
  ModelToolCall,
} from "../../../modules/model-gateway";
import type { WindowPolicy } from "../../../modules/window-budget";
import type { RepoBuildState } from "../../../modules/verification";

import type { EstablishedFact } from "../actions";
import { estimateStickyMutableChars } from "../actions";
import type { PromptCacheClass } from "../actions/resolvePromptCacheClass";
import {
  isProviderInfrastructureFailure,
  providerInfrastructureUserMessage,
} from "../actions/resolveProviderInfrastructure";
import type { AgentReasonCode } from "../contracts";
import type { ContextEpoch } from "../internal/context-epoch";
import type { AgentLogVerbosity } from "../internal/logVerbosity";
import type { RunBudgetTracker } from "../internal/RunBudget";
import type { InMemorySessionHistoryArchive } from "../internal/session-history";
import type { InstructionBodiesByKind } from "../internal/system-context";
import type { TaskListRef } from "../internal/taskListRuntime";
import type { EventBus } from "../internal/EventBus";
import { discardIncompleteToolCalls } from "../modules/complete-tool-calls";
import type { ToolLoopGuard } from "../modules/tool-loop-guard";
import { consumeModelTurn } from "./consumeModelTurn";
import type { OfferContinueFn } from "./createOfferContinue";
import type { AgentEngineRuntime } from "./runtime";
import type { ToolLoopOutcome } from "./types";
import { prepareModelLoopModelTurn } from "./runModelLoopModelTurnPrepare";

export type ModelTurnSuccess = {
  kind: "completed";
  turn: Extract<
    Awaited<ReturnType<typeof consumeModelTurn>>,
    { kind: "completed" }
  >;
  toolCalls: ModelToolCall[];
  discardedCount: number;
  truncated: boolean;
  memoryFacts: { id: string; content: string }[] | undefined;
  emittedLoopPressureWarning: boolean;
  emittedLoopCompactionWarning: boolean;
  lastPromptCacheClass: PromptCacheClass | undefined;
  contextEpoch: ContextEpoch | undefined;
};

export type ModelTurnResult =
  | ModelTurnSuccess
  | { kind: "cancelled" }
  | { kind: "done"; outcome: ToolLoopOutcome };

/**
 * Record budget, prepare the request (tool locks / compaction), call the model,
 * emit model_turn, and discard incomplete truncated tool calls.
 */
export async function runModelLoopModelTurn(params: {
  runtime: AgentEngineRuntime;
  bus: EventBus;
  runId: string;
  signal: AbortSignal;
  llm: LlmPort;
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
  answer: string;
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
  maxReasoningCharsWithoutProgress: number;
  offerContinue: OfferContinueFn;
}): Promise<ModelTurnResult> {
  const {
    runtime,
    bus,
    runId,
    signal,
    llm,
    budget,
    answer,
    reasonCodes,
    warnings,
    offerContinue,
  } = params;

  budget.recordModelCall();
  budget.recordLoopIteration();
  runtime.emitStage(bus, runId, "model_running", "started");

  const prepared = await prepareModelLoopModelTurn(params);

  const turn = await consumeModelTurn(runtime, {
    llm,
    request: prepared.turnRequest,
    runId,
    signal,
    bus,
    maxReasoningCharsWithoutProgress: params.maxReasoningCharsWithoutProgress,
  });

  if (turn.kind === "cancelled") {
    return { kind: "cancelled" };
  }
  if (turn.kind === "failed") {
    reasonCodes.push("provider_failed");
    if (
      isProviderInfrastructureFailure({
        errorCode: turn.errorCode,
        errorMessage: turn.errorMessage,
      })
    ) {
      reasonCodes.push("provider_infrastructure_unavailable");
      const infraAnswer = providerInfrastructureUserMessage({
        errorMessage: turn.errorMessage,
      });
      return {
        kind: "done",
        outcome: offerContinue(
          "provider_unavailable",
          turn.content || answer || infraAnswer,
        ),
      };
    }
    return {
      kind: "done",
      outcome: {
        kind: "failed",
        answer: turn.content || answer || undefined,
        extraReasons: [],
        error: { code: turn.errorCode, message: turn.errorMessage },
      },
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

  return {
    kind: "completed",
    turn,
    toolCalls,
    discardedCount,
    truncated,
    memoryFacts: prepared.memoryFacts,
    emittedLoopPressureWarning: prepared.emittedLoopPressureWarning,
    emittedLoopCompactionWarning: prepared.emittedLoopCompactionWarning,
    lastPromptCacheClass: prepared.promptCacheClass,
    contextEpoch: prepared.contextEpoch,
  };
}
