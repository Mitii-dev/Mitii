/**
 * Continue executeOneTool after cache/ledger short-circuits.
 */
import { TOOL_RUNTIME_SCHEMA_VERSION } from "../../tool-runtime";

import { serializeToolResultForModel } from "../actions";
import type { AgentEngineRuntime } from "./runtime";
import type { ToolCallOutcome } from "./types";
import {
  approvalRequiredOutcome,
  applySucceededToolSideEffects,
  cacheSucceededReadonlyTool,
  emitToolCompletedAndRecord,
} from "./executeToolFinishPostSuccess";
import { rejectIfChangeImpactOrMustReadGate } from "./executeToolFinishGates";
import { finishUpdateTodosTool } from "./executeToolFinishUpdateTodos";
import type { ExecuteToolContinueContext } from "./executeToolFinishTypes";

export type { ExecuteToolContinueContext } from "./executeToolFinishTypes";

export async function finishExecuteOneTool(
  runtime: AgentEngineRuntime,
  ctx: ExecuteToolContinueContext,
): Promise<ToolCallOutcome> {
  const {
    toolCall,
    argumentsValue,
    summary,
    grant,
    mutatingToolNames,
    changeImpactGate,
    taskListRef,
    establishedFacts,
    loopFileReads,
    windowPolicy,
    toolCache,
    readLedger,
    budget,
    warnings,
    reasonCodes,
    bus,
    runId,
    evidence,
    taskListAutoAdvance,
    taskListAutoAdvanceBudget,
    plan,
    changedFiles,
    mutationCheckpointIds,
    approvalToken,
    dirtyPaths,
    pinnedState,
    workspaceRoot,
    signal,
  } = ctx;

  budget.recordToolCall();
  const preToolActiveId = taskListRef?.current?.items.find(
    (item) => item.status === "active",
  )?.id;

  const gated = rejectIfChangeImpactOrMustReadGate(runtime, ctx);
  if (gated) {
    return gated;
  }

  const todos = finishUpdateTodosTool(runtime, ctx);
  if (todos) {
    return todos;
  }

  const result = await runtime.deps.tools!.execute(
    {
      schemaVersion: TOOL_RUNTIME_SCHEMA_VERSION,
      callId: toolCall.id,
      toolName: toolCall.name,
      arguments: argumentsValue,
      grant,
      workspaceRoot,
      pinnedState,
    },
    {
      signal,
      dirtyPaths,
      alreadyMutatedPaths: changedFiles,
      approval: approvalToken,
      maxContentChars: windowPolicy.compaction.toolResultContentChars,
      ...(runtime.deps.adversary
        ? {
            adversary: runtime.deps.adversary,
            adversaryFailMode: runtime.deps.adversaryFailMode,
          }
        : {}),
    },
  );

  if (result.status === "rejected" && result.reasonCode === "approval_required") {
    return approvalRequiredOutcome({
      runtime,
      bus,
      runId,
      toolCall,
      argumentsValue,
      summary,
      result,
    });
  }

  toolCache.set(toolCall.id, result);
  if (result.status === "succeeded") {
    cacheSucceededReadonlyTool({
      toolCall,
      argumentsValue,
      result,
      toolCache,
      readLedger,
      loopFileReads,
      establishedFacts,
      windowPolicy,
    });
    applySucceededToolSideEffects({
      runtime,
      bus,
      runId,
      toolCall,
      result,
      changeImpactGate,
      mutationCheckpointIds,
      changedFiles,
      toolCache,
      readLedger,
      establishedFacts,
      reasonCodes,
      warnings,
      taskListAutoAdvance,
      taskListAutoAdvanceBudget,
      taskListRef,
      preToolActiveId,
      mutatingToolNames,
      plan,
      budget,
      evidence,
    });
  }

  if (result.status === "failed" || result.status === "rejected") {
    warnings.push(
      `Tool ${toolCall.name} ${result.status}${
        result.reasonCode ? ` (${result.reasonCode})` : ""
      }.`,
    );
  }

  emitToolCompletedAndRecord({
    runtime,
    bus,
    runId,
    toolCall,
    result,
    summary,
    evidence,
  });

  return {
    kind: "message",
    message: {
      role: "tool",
      toolCallId: toolCall.id,
      content: serializeToolResultForModel(result, {
        maxContentChars: windowPolicy.compaction.toolResultContentChars,
      }),
    },
  };
}
