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
import type { ToolLoopGuard, ToolLoopResult } from "../modules/tool-loop-guard";
import { isMutateLockAllowedToolName } from "../modules/mutate-readiness";
import {
  collectGrantExpansionFromBatch,
  toolResultError,
} from "./settleToolsGrantExpansion";
import { rejectMutateLockBlockedTool } from "./settleToolsMutateLockReject";
import {
  batchNeedsWorkspaceTools,
  settleToolsPreflightFailure,
} from "./settleToolsPreflight";

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

  const grant = decision.toolGrant;
  const needsWorkspaceTools = batchNeedsWorkspaceTools(toolCalls);
  const preflightFailure = settleToolsPreflightFailure({
    needsWorkspaceTools,
    grant,
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

