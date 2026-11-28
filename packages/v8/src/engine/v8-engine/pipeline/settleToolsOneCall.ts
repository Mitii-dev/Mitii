/**
 * Execute one tool in a settle batch and update mutation/reject stats.
 */
import type { ExecutionDecision } from "../../../modules/decision-policy";
import type { ModelMessage, ModelToolCall } from "../../../modules/model-gateway";
import type { AgentMode } from "../../../modules/request-intake";
import type { WindowPolicy } from "../../../modules/window-budget";
import type { RepositoryStateReference } from "../../../modules/repository-state";

import type { AgentReasonCode, RunEvidence } from "../contracts";
import type { EstablishedFact } from "../actions";
import { summarizeToolCall } from "../actions/summarizeToolCall";
import type { LoopFileReadTracker } from "../actions/isExplorationRereadHeavy";
import type { EventBus } from "../internal/EventBus";
import type { ReadLedger } from "../internal/ReadLedger";
import type { RunBudgetTracker } from "../internal/RunBudget";
import type { ToolCallCache } from "../internal/ToolCallCache";
import type { TaskListRef } from "../internal/taskListRuntime";
import type { ToolLoopResult } from "../modules/tool-loop-guard";
import {
  DEFAULT_MUTATING_TOOL_NAMES,
  GIT_WRITE_TOOL_NAMES,
  executeOneTool,
} from "./executeTool";
import { writeRestorePointAfterMutation } from "./writeRestorePoint";
import type { AgentEngineRuntime } from "./runtime";
import { toolResultError } from "./settleToolsGrantExpansion";
import type { RejectedMutationInfo } from "./settleToolsTypes";
import type { ToolLoopOutcome } from "./types";

export type SettleOneCallResult =
  | { kind: "return"; outcome: ToolLoopOutcome }
  | {
      kind: "stats";
      succeededMutating: boolean;
      succeededGitWrite: boolean;
      rejectedMutation?: RejectedMutationInfo;
    };

export async function settleOneToolCall(params: {
  runtime: AgentEngineRuntime;
  runId: string;
  requestId: string;
  interactionMode: AgentMode;
  bus: EventBus;
  signal: AbortSignal;
  decision: ExecutionDecision;
  toolCall: ModelToolCall;
  messages: ModelMessage[];
  toolCache: ToolCallCache;
  readLedger: ReadLedger;
  budget: RunBudgetTracker;
  warnings: string[];
  reasonCodes: AgentReasonCode[];
  dirtyPaths: readonly string[] | undefined;
  pinnedState: RepositoryStateReference | undefined;
  workspaceRoot: string;
  changedFiles: string[];
  mutationCheckpointIds: string[];
  taskListRef: TaskListRef;
  evidence?: RunEvidence;
  establishedFacts: EstablishedFact[];
  windowPolicy: WindowPolicy;
  answer: string;
  mustReadNudgeBudget: { remaining: number };
  changeImpactGate: {
    required: boolean;
    satisfied: boolean;
    lastImpactAffectedFiles?: string[];
    lastWidenVerification?: boolean;
  };
  changeImpactNudgeBudget: { remaining: number };
  loopFileReads?: LoopFileReadTracker;
  taskListAutoAdvanceBudget: { remaining: number };
  results: ToolLoopResult[];
  priorRejectedMutation?: RejectedMutationInfo;
}): Promise<SettleOneCallResult> {
  const {
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
    workspaceRoot,
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
  } = params;

  const mutationIdsBefore = mutationCheckpointIds.length;
  const outcome = await executeOneTool(runtime, {
    runId,
    toolCall,
    grant: decision.toolGrant,
    pinnedState,
    workspaceRoot,
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

  let succeededMutating = false;
  let succeededGitWrite = false;
  let rejectedMutation = params.priorRejectedMutation;
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

  return {
    kind: "stats",
    succeededMutating,
    succeededGitWrite,
    rejectedMutation,
  };
}
