import type { ExecutionDecision } from "../../../modules/decision-policy";
import type { ModelMessage, ModelToolCall } from "../../../modules/model-gateway";
import type { AgentMode } from "../../../modules/request-intake";
import type { WindowPolicy } from "../../../modules/window-budget";
import type {
  RepositoryStateReference,
} from "../../../modules/repository-state";

import type {
  AgentReasonCode,
  RunEvidence,
} from "../../agent-engine/contracts";
import type { EstablishedFact } from "../../agent-engine/actions";
import { EventBus } from "../../agent-engine/internal/EventBus";
import { ReadLedger } from "../../agent-engine/internal/ReadLedger";
import { RunBudgetTracker } from "../../agent-engine/internal/RunBudget";
import { ToolCallCache } from "../../agent-engine/internal/ToolCallCache";
import type { TaskListRef } from "../../agent-engine/internal/taskListRuntime";
import {
  DEFAULT_MUTATING_TOOL_NAMES,
  executeOneTool,
} from "../../agent-engine/pipeline/executeTool";
import { writeRestorePointAfterMutation } from "../../agent-engine/pipeline/writeRestorePoint";
import type { AgentEngineRuntime } from "../../agent-engine/pipeline/runtime";
import type { ToolLoopOutcome } from "../../agent-engine/pipeline/types";
import type { ToolLoopGuard, ToolLoopResult } from "../actions/toolLoopGuard";

export type SettleBatchStats = {
  succeededMutating: boolean;
  readonlyOnly: boolean;
  results: ToolLoopResult[];
};

export type SettleToolsResult =
  | { kind: "continue"; decision: ExecutionDecision; stats: SettleBatchStats }
  | { kind: "return"; outcome: ToolLoopOutcome };

/**
 * Settle one tool batch. No mutation-lock / evidence-spend rails.
 * Writes restore points after successful mutating tools when the store supports it.
 */
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
  } = params;

  const grant = decision.toolGrant;
  const needsWorkspaceTools = toolCalls.some(
    (call) => call.name !== "update_todos",
  );

  if (needsWorkspaceTools && grant.allowedTools.length === 0) {
    return {
      kind: "return",
      outcome: {
        kind: "failed",
        answer: answer || undefined,
        extraReasons: ["misconfigured"],
        error: {
          code: "tool_calls_without_grant",
          message:
            "Model requested workspace tools on a route where no tools were granted.",
        },
      },
    };
  }
  if (needsWorkspaceTools && !runtime.deps.tools) {
    return {
      kind: "return",
      outcome: {
        kind: "failed",
        answer: answer || undefined,
        extraReasons: ["misconfigured"],
        error: {
          code: "misconfigured",
          message: "Model requested tools but Tool Runtime is not configured.",
        },
      },
    };
  }
  if (needsWorkspaceTools && !workspaceRoot) {
    return {
      kind: "return",
      outcome: {
        kind: "failed",
        answer: answer || undefined,
        extraReasons: ["misconfigured"],
        error: {
          code: "misconfigured",
          message: "Model requested tools but workspaceRoot was not provided.",
        },
      },
    };
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
  const mustReadNudgeBudget = { remaining: 0 };
  const changeImpactNudgeBudget = { remaining: 0 };
  const changeImpactGate = { required: false, satisfied: true };

  const results: ToolLoopResult[] = [];
  let succeededMutating = false;

  for (const toolCall of toolCalls) {
    if (signal.aborted) {
      return { kind: "return", outcome: { kind: "cancelled" } };
    }
    if (!budget.canStartToolCall()) {
      return {
        kind: "return",
        outcome: {
          kind: "budget_exhausted",
          answer: answer || undefined,
          message: "Tool call budget exhausted.",
          changedFiles,
          mutationCheckpointIds,
        },
      };
    }

    const mutationIdsBefore = mutationCheckpointIds.length;
    const outcome = await executeOneTool(runtime, {
      runId,
      toolCall,
      grant,
      pinnedState,
      workspaceRoot: workspaceRoot ?? ".",
      bus,
      signal,
      toolCache,
      readLedger,
      budget,
      warnings,
      reasonCodes,
      dirtyPaths,
      changedFiles,
      mutationCheckpointIds,
      approvalToken: undefined,
      taskListRef,
      taskListAutoAdvance: runtime.deps.taskListAutoAdvance === true,
      taskListAutoAdvanceBudget,
      mutatingToolNames: DEFAULT_MUTATING_TOOL_NAMES,
      changeImpactGate,
      changeImpactNudgeBudget,
      mustReadNudgeBudget,
      evidence,
      establishedFacts,
      windowPolicy,
    });

    if (outcome.kind === "approval_required") {
      const approvalId = runtime.deps.idGenerator.next("appr");
      return {
        kind: "return",
        outcome: {
          kind: "approval_required",
          messages,
          toolCache,
          pendingApproval: {
            approvalId,
            fingerprint: outcome.fingerprint,
            toolName: outcome.toolName,
            callId: outcome.callId,
            arguments: outcome.arguments,
            paths: outcome.paths,
          },
          changedFiles,
          mutationCheckpointIds,
          answer: answer || undefined,
          decision,
        },
      };
    }

    messages.push(outcome.message);
    const cached = toolCache.get(toolCall.id);
    const success = cached?.status === "succeeded";
    results.push({
      name: toolCall.name,
      success,
      output:
        typeof cached?.output === "string"
          ? cached.output
          : cached?.output
            ? JSON.stringify(cached.output).slice(0, 240)
            : undefined,
      error: cached?.summary,
    });

    if (success && DEFAULT_MUTATING_TOOL_NAMES.has(toolCall.name)) {
      succeededMutating = true;
      if (mutationCheckpointIds.length > mutationIdsBefore) {
        const mutationCheckpointId =
          mutationCheckpointIds[mutationCheckpointIds.length - 1]!;
        await writeRestorePointAfterMutation(runtime, {
          runId,
          requestId,
          interactionMode,
          mutationCheckpointId,
          mutationCheckpointIds,
          messages,
          toolCache,
          changedFiles,
          taskList: taskListRef.current,
          completedPlanStepIds: taskListRef.completedPlanStepIds,
        });
      }
    }
  }

  if (toolLoopGuard) {
    toolLoopGuard.observeResults(results);
  }

  runtime.emitStage(bus, runId, "tool_running", "completed");
  return {
    kind: "continue",
    decision,
    stats: {
      succeededMutating,
      readonlyOnly: toolCalls.every(
        (call) =>
          call.name === "update_todos" ||
          !DEFAULT_MUTATING_TOOL_NAMES.has(call.name),
      ),
      results,
    },
  };
}
