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
} from "../contracts";
import type { EstablishedFact } from "../actions";
import { summarizeToolCall } from "../actions/summarizeToolCall";
import type { LoopFileReadTracker } from "../actions/isExplorationRereadHeavy";
import { EventBus } from "../internal/EventBus";
import { ReadLedger } from "../internal/ReadLedger";
import { RunBudgetTracker } from "../internal/RunBudget";
import { ToolCallCache } from "../internal/ToolCallCache";
import type { TaskListRef } from "../internal/taskListRuntime";
import {
  DEFAULT_MUTATING_TOOL_NAMES,
  GIT_WRITE_TOOL_NAMES,
  executeOneTool,
} from "./executeTool";
import { writeRestorePointAfterMutation } from "./writeRestorePoint";
import type { AgentEngineRuntime } from "./runtime";
import type { ToolLoopOutcome } from "./types";
import type { ToolResult } from "../../tool-runtime";
import type { ToolLoopGuard, ToolLoopResult } from "../actions/toolLoopGuard";
import { isMutateLockAllowedToolName } from "../modules/mutate-readiness";
import { serializeToolResultForModel } from "../actions/serializeToolResultForModel";
import { TOOL_RUNTIME_SCHEMA_VERSION } from "../../tool-runtime";

export type RejectedMutationInfo = {
  toolName: string;
  status: ToolResult["status"];
  reasonCode?: ToolResult["reasonCode"];
  warnings: readonly string[];
  summary?: string;
};

export type SettleBatchStats = {
  succeededMutating: boolean;
  /** Succeeded git_write tool (e.g. git_signoff_range) — satisfies VCS-only execute. */
  succeededGitWrite: boolean;
  readonlyOnly: boolean;
  results: ToolLoopResult[];
  /** Last failed mutating tool in this batch (if any). */
  rejectedMutation?: RejectedMutationInfo;
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
  /** Soft must-read nudge budget (mutated in place by executeOneTool). */
  mustReadNudgeBudget: { remaining: number };
  /**
   * Soft change-impact gate (mutated in place). Armed when decision recommends
   * analyze_change_impact on a write grant; persists across tool batches.
   */
  changeImpactGate: { required: boolean; satisfied: boolean };
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

  const results: ToolLoopResult[] = [];
  let succeededMutating = false;
  let succeededGitWrite = false;
  let rejectedMutation: RejectedMutationInfo | undefined;

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

    if (
      awaitingMutateOnly &&
      !isMutateLockAllowedToolName(toolCall.name, {
        allowTargetedReads: mutateLockAllowTargetedReads,
      })
    ) {
      budget.recordToolCall();
      let argumentsValue: unknown = {};
      try {
        argumentsValue =
          toolCall.arguments.trim().length === 0
            ? {}
            : JSON.parse(toolCall.arguments);
      } catch {
        argumentsValue = { _raw: toolCall.arguments };
      }
      const summary = summarizeToolCall(toolCall.name, argumentsValue);
      const rejectMessage =
        `Tool "${toolCall.name}" is blocked under mutate lock (tool_not_allowed). ` +
        (mutateLockAllowTargetedReads
          ? "Call read_file/read_many_files for named write/mustRead paths, then apply_patch."
          : "Call apply_patch now. Discovery tools are not allowed until the patch lands.");
      const nowIso = runtime.isoNow();
      const rejected: ToolResult = {
        schemaVersion: TOOL_RUNTIME_SCHEMA_VERSION,
        callId: toolCall.id,
        toolName: toolCall.name,
        status: "rejected",
        reasonCode: "tool_not_allowed",
        truncated: false,
        redacted: false,
        durationMs: 0,
        bytesProduced: 0,
        warnings: [rejectMessage],
        output: rejectMessage,
        audit: {
          callId: toolCall.id,
          toolName: toolCall.name,
          startedAt: nowIso,
          endedAt: nowIso,
          status: "rejected",
          reasonCode: "tool_not_allowed",
          inputPreview: summary ?? toolCall.name,
          bytesProduced: 0,
          durationMs: 0,
          truncated: false,
          redacted: false,
        },
      };
      toolCache.set(toolCall.id, rejected);
      reasonCodes.push("step_mutate_lock_enforced");
      warnings.push(rejectMessage);
      runtime.emit(bus, {
        type: "tool_started",
        runId,
        callId: toolCall.id,
        toolName: toolCall.name,
        ...(summary ? { summary } : {}),
        at: runtime.isoNow(),
      });
      runtime.emit(bus, {
        type: "tool_completed",
        runId,
        callId: toolCall.id,
        toolName: toolCall.name,
        status: "rejected",
        reasonCode: "tool_not_allowed",
        ...(summary ? { summary } : {}),
        warnings: [rejectMessage],
        at: runtime.isoNow(),
      });
      messages.push({
        role: "tool",
        toolCallId: toolCall.id,
        content: serializeToolResultForModel(rejected, {
          maxContentChars: windowPolicy.compaction.toolResultContentChars,
        }),
      });
      results.push({
        name: toolCall.name,
        success: false,
        error: rejectMessage,
      });
      continue;
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
      loopFileReads,
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
      error: toolResultError(cached),
    });

    const isMutating = DEFAULT_MUTATING_TOOL_NAMES.has(toolCall.name);
    const isGitWrite = GIT_WRITE_TOOL_NAMES.has(toolCall.name);
    if (success && isGitWrite) {
      succeededGitWrite = true;
    }
    if (success && isMutating) {
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
    } else if (
      isMutating &&
      cached &&
      cached.status !== "succeeded" &&
      cached.reasonCode !== "approval_required" &&
      cached.reasonCode !== "must_read_incomplete" &&
      cached.reasonCode !== "change_impact_incomplete"
    ) {
      let parsedArgs: unknown = {};
      try {
        parsedArgs =
          toolCall.arguments.trim().length === 0
            ? {}
            : JSON.parse(toolCall.arguments);
      } catch {
        parsedArgs = {};
      }
      rejectedMutation = {
        toolName: toolCall.name,
        status: cached.status,
        reasonCode: cached.reasonCode,
        warnings: cached.warnings,
        summary: summarizeToolCall(toolCall.name, parsedArgs),
      };
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
      succeededGitWrite,
      readonlyOnly: toolCalls.every(
        (call) =>
          call.name === "update_todos" ||
          (!DEFAULT_MUTATING_TOOL_NAMES.has(call.name) &&
            !GIT_WRITE_TOOL_NAMES.has(call.name)),
      ),
      results,
      rejectedMutation,
    },
  };
}

/** Short failure text for tool-loop signatures. Successful results have none. */
function toolResultError(result: ToolResult | undefined): string | undefined {
  if (!result || result.status === "succeeded") {
    return undefined;
  }
  const parts = [
    result.reasonCode,
    result.warnings.find((warning) => warning.length > 0),
    result.audit.outputPreview,
  ].filter((part): part is string => Boolean(part));
  return parts.length > 0 ? parts.join(": ") : undefined;
}
