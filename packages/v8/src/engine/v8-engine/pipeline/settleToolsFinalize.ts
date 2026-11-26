/**
 * Post-batch settle finalize: grant expansion suspend or continue stats.
 */
import type { ExecutionDecision } from "../../../modules/decision-policy";
import type { ModelMessage, ModelToolCall } from "../../../modules/model-gateway";

import type { AgentReasonCode } from "../contracts";
import type { EventBus } from "../internal/EventBus";
import type { ToolCallCache } from "../internal/ToolCallCache";
import type { ToolLoopGuard, ToolLoopResult } from "../modules/tool-loop-guard";
import {
  DEFAULT_MUTATING_TOOL_NAMES,
  GIT_WRITE_TOOL_NAMES,
} from "./executeTool";
import type { AgentEngineRuntime } from "./runtime";
import { collectGrantExpansionFromBatch } from "./settleToolsGrantExpansion";
import type {
  RejectedMutationInfo,
  SettleBatchStats,
  SettleToolsResult,
} from "./settleToolsTypes";

export function finalizeSettledToolBatch(params: {
  runtime: AgentEngineRuntime;
  bus: EventBus;
  runId: string;
  decision: ExecutionDecision;
  toolCalls: readonly ModelToolCall[];
  messages: ModelMessage[];
  toolCache: ToolCallCache;
  warnings: string[];
  reasonCodes: AgentReasonCode[];
  workspaceRoot: string | undefined;
  changedFiles: string[];
  mutationCheckpointIds: string[];
  answer: string;
  toolLoopGuard?: ToolLoopGuard;
  results: ToolLoopResult[];
  succeededMutating: boolean;
  succeededGitWrite: boolean;
  rejectedMutation: RejectedMutationInfo | undefined;
}): SettleToolsResult {
  const {
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
  } = params;

  if (toolLoopGuard) {
    toolLoopGuard.observeResults(results);
  }

  const expansion = collectGrantExpansionFromBatch({
    toolCalls,
    toolCache,
    warnings,
    workspaceRoot: workspaceRoot ?? ".",
  });
  if (
    expansion.extraPaths.length > 0 ||
    expansion.externalRoots.length > 0
  ) {
    const preview = [
      ...expansion.extraPaths.slice(0, 4),
      ...expansion.externalRoots.slice(0, 2),
    ];
    reasonCodes.push("grant_expansion_suspended");
    warnings.push(
      `Path access needs permission: ${preview.join(", ")}. Approve to expand the grant and continue, or deny to stop.`,
    );
    runtime.emitStage(bus, runId, "tool_running", "completed");
    return {
      kind: "return",
      outcome: {
        kind: "grant_expansion_required",
        messages,
        toolCache,
        extraPaths: expansion.extraPaths,
        ...(expansion.externalRoots.length > 0
          ? { externalRoots: expansion.externalRoots }
          : {}),
        ...(expansion.pendingToolCalls.length > 0
          ? { pendingToolCalls: expansion.pendingToolCalls }
          : {}),
        changedFiles,
        mutationCheckpointIds,
        answer: answer || undefined,
        decision,
      },
    };
  }

  runtime.emitStage(bus, runId, "tool_running", "completed");
  const stats: SettleBatchStats = {
    succeededMutating,
    succeededGitWrite,
    readonlyOnly: toolCalls.every(
      (call) =>
        call.name === "update_todos" ||
        (!DEFAULT_MUTATING_TOOL_NAMES.has(call.name) &&
          !GIT_WRITE_TOOL_NAMES.has(call.name)),
    ),
    results,
    rejectedMutation,
  };
  return { kind: "continue", decision, stats };
}
