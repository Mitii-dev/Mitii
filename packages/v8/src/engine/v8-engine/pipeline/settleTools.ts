/**
 * Settle one tool batch. No mutation-lock / evidence-spend rails.
 * Writes restore points after successful mutating tools when the store supports it.
 */
import type { ExecutionDecision } from "../../../modules/decision-policy";
import type { ModelMessage, ModelToolCall } from "../../../modules/model-gateway";
import type { AgentMode } from "../../../modules/request-intake";
import type { WindowPolicy } from "../../../modules/window-budget";
import type { RepositoryStateReference } from "../../../modules/repository-state";

import type { AgentReasonCode, RunEvidence } from "../contracts";
import type { EstablishedFact } from "../actions";
import type { LoopFileReadTracker } from "../actions/isExplorationRereadHeavy";
import type { EventBus } from "../internal/EventBus";
import type { ReadLedger } from "../internal/ReadLedger";
import type { RunBudgetTracker } from "../internal/RunBudget";
import type { ToolCallCache } from "../internal/ToolCallCache";
import type { TaskListRef } from "../internal/taskListRuntime";
import type { ToolLoopGuard, ToolLoopResult } from "../modules/tool-loop-guard";
import { isMutateLockAllowedToolName } from "../modules/mutate-readiness";
import type { AgentEngineRuntime } from "./runtime";
import { rejectMutateLockBlockedTool } from "./settleToolsMutateLockReject";
import {
  batchNeedsWorkspaceTools,
  settleToolsPreflightFailure,
} from "./settleToolsPreflight";
import { settleOneToolCall } from "./settleToolsOneCall";
import { finalizeSettledToolBatch } from "./settleToolsFinalize";
import type {
  RejectedMutationInfo,
  SettleToolsResult,
} from "./settleToolsTypes";

export type {
  RejectedMutationInfo,
  SettleBatchStats,
  SettleToolsResult,
} from "./settleToolsTypes";

export async function settleToolBatch(params: {
  runtime: AgentEngineRuntime;
  runId: string;
  requestId: string;
  interactionMode: AgentMode;
  bus: EventBus;
  signal: AbortSignal;
  decision: ExecutionDecision;
  toolCalls: readonly ModelToolCall[];
  turnContent: string;
  messages: ModelMessage[];
  toolCache: ToolCallCache;
  readLedger: ReadLedger;
  budget: RunBudgetTracker;
  warnings: string[];
  reasonCodes: AgentReasonCode[];
  dirtyPaths: readonly string[] | undefined;
  pinnedState: RepositoryStateReference | undefined;
  workspaceRoot: string | undefined;
  changedFiles: string[];
  mutationCheckpointIds: string[];
  taskListRef: TaskListRef;
  evidence?: RunEvidence;
  establishedFacts: EstablishedFact[];
  windowPolicy: WindowPolicy;
  answer: string;
  toolLoopGuard?: ToolLoopGuard;
  /** Soft must-read nudge budget (mutated in place by executeOneTool). */
  mustReadNudgeBudget: { remaining: number };
  /**
   * Soft change-impact gate (mutated in place). Armed when decision recommends
   * analyze_change_impact on a write grant; persists across tool batches.
   */
  changeImpactGate: {
    required: boolean;
    satisfied: boolean;
    lastImpactAffectedFiles?: string[];
    lastWidenVerification?: boolean;
  };
  changeImpactNudgeBudget: { remaining: number };
  loopFileReads?: LoopFileReadTracker;
  /** When true, reject tools outside the mutate-lock allowlist at execution. */
  awaitingMutateOnly?: boolean;
  mutateLockAllowTargetedReads?: boolean;
}): Promise<SettleToolsResult> {
  const {
    runtime,
    runId,
    requestId,
    interactionMode,
    bus,
    signal,
    decision,
    toolCalls,
    turnContent,
    messages,
    toolCache,
    readLedger,
    budget,
    warnings,
    reasonCodes,
    dirtyPaths,
    pinnedState,
    workspaceRoot,
    changedFiles,
    mutationCheckpointIds,
    taskListRef,
    evidence,
    establishedFacts,
    windowPolicy,
    answer,
    toolLoopGuard,
    mustReadNudgeBudget,
    changeImpactGate,
    changeImpactNudgeBudget,
    loopFileReads,
  } = params;
  const awaitingMutateOnly = params.awaitingMutateOnly === true;
  const mutateLockAllowTargetedReads =
    params.mutateLockAllowTargetedReads !== false;

  const needsWorkspaceTools = batchNeedsWorkspaceTools(toolCalls);
  const preflightFailure = settleToolsPreflightFailure({
    needsWorkspaceTools,
    grant: decision.toolGrant,
    runtime,
    workspaceRoot,
    answer,
  });
  if (preflightFailure) {
    return { kind: "return", outcome: preflightFailure };
  }

  messages.push({
    role: "assistant",
    content: turnContent,
    toolCalls: [...toolCalls],
  });

  runtime.emitStage(bus, runId, "tool_running", "started");

  const taskListAutoAdvanceBudget = {
    remaining: runtime.deps.taskListAutoAdvance === true ? 1 : 0,
  };

  const results: ToolLoopResult[] = [];
  let succeededMutating = false;
  let succeededGitWrite = false;
  let rejectedMutation: RejectedMutationInfo | undefined;

  for (const toolCall of toolCalls) {
    if (signal.aborted) {
      return { kind: "return", outcome: { kind: "cancelled" } };
    }
    if (!budget.canStartToolCall()) {
      // Soft tool ceiling mid-batch: raise toward hard so an in-flight
      // mutation batch is not killed. Hard ceiling still terminates.
      if (budget.canExtendToolSoft()) {
        const nextSoft = budget.raiseSoftToolCeiling(
          windowPolicy.run.maxToolCalls,
        );
        reasonCodes.push("run_budget_soft_wall");
        warnings.push(
          `Raised soft tool-call budget to ${nextSoft} (hard ${budget.hardMaxToolCalls()}).`,
        );
      } else {
        return {
          kind: "return",
          outcome: {
            kind: "budget_exhausted",
            answer: answer || undefined,
            message: "Hard tool-call safety ceiling reached.",
            changedFiles,
            mutationCheckpointIds,
          },
        };
      }
    }

    if (
      awaitingMutateOnly &&
      !isMutateLockAllowedToolName(toolCall.name, {
        allowTargetedReads: mutateLockAllowTargetedReads,
      })
    ) {
      rejectMutateLockBlockedTool({
        runtime,
        bus,
        runId,
        toolCall,
        mutateLockAllowTargetedReads,
        budget,
        toolCache,
        messages,
        reasonCodes,
        warnings,
        windowPolicy,
        results,
      });
      continue;
    }

    const one = await settleOneToolCall({
      runtime,
      runId,
      requestId,
      interactionMode,
      bus,
      signal,
      decision,
      toolCall,
      messages,
      toolCache,
      readLedger,
      budget,
      warnings,
      reasonCodes,
      dirtyPaths,
      pinnedState,
      workspaceRoot: workspaceRoot ?? ".",
      changedFiles,
      mutationCheckpointIds,
      taskListRef,
      evidence,
      establishedFacts,
      windowPolicy,
      answer,
      mustReadNudgeBudget,
      changeImpactGate,
      changeImpactNudgeBudget,
      loopFileReads,
      taskListAutoAdvanceBudget,
      results,
      priorRejectedMutation: rejectedMutation,
    });
    if (one.kind === "return") {
      return { kind: "return", outcome: one.outcome };
    }
    if (one.succeededMutating) succeededMutating = true;
    if (one.succeededGitWrite) succeededGitWrite = true;
    rejectedMutation = one.rejectedMutation;
  }

  return finalizeSettledToolBatch({
    runtime,
    bus,
    runId,
    decision,
    toolCalls,
    messages,
    toolCache,
    warnings,
    reasonCodes,
    workspaceRoot,
    changedFiles,
    mutationCheckpointIds,
    answer,
    toolLoopGuard,
    results,
    succeededMutating,
    succeededGitWrite,
    rejectedMutation,
  });
}
