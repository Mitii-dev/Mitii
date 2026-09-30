import type { ToolGrant } from "../../../modules/decision-policy";
import { READ_ONLY_TOOL_IDS } from "../../../modules/decision-policy";
import type { ModelToolCall } from "../../../modules/model-gateway";
import type { PlanArtifact } from "../../../modules/planning";
import type { RepositoryStateReference } from "../../../modules/repository-state";
import type { WindowPolicy } from "../../../modules/window-budget";
import {
  TOOL_RUNTIME_SCHEMA_VERSION,
  fingerprintToolCall,
  toolResultSchema,
} from "../../tool-runtime";
import type { ToolApprovalToken } from "../../tool-runtime";

import {
  dropEstablishedFactsForPaths,
  extractEstablishedFact,
  extractMutationTargetPaths,
  extractToolContentPaths,
  missingMustReadPaths,
  buildMustReadNudgeMessage,
  upsertEstablishedFact,
  serializeToolResultForModel,
  recordToolEvidence,
} from "../actions";
import type {
  EstablishedFact,
  LoopFileReadTracker,
} from "../actions";
import { ToolCallCache } from "../internal/ToolCallCache";
import { ReadLedger } from "../internal/ReadLedger";
import type { AgentReasonCode, RunEvidence } from "../contracts";
import { EventBus } from "../internal/EventBus";
import { RunBudgetTracker } from "../internal/RunBudget";
import {
  applyUpdateTodosArguments,
  buildUpdateTodosToolResult,
  isUpdateTodosTool,
  markTaskListUpdated,
  maybeAutoAdvanceTaskList,
  maybeRefillTaskListFromPlan,
  planProgressOf,
  recordCompletedPlanSteps,
  type TaskListRef,
} from "../internal/taskListRuntime";
import { markPlanEvidenceStepsDone } from "../actions/runEvidence";
import type { AgentEngineRuntime } from "./runtime";
import type { ToolCallOutcome } from "./types";
import { toolCompletionDiagnostics } from "./executeToolSupport";

export type ExecuteToolContinueContext = {
  toolCall: ModelToolCall;
  argumentsValue: unknown;
  summary: string | undefined;
  grant: ToolGrant;
  mutatingToolNames: ReadonlySet<string>;
  changeImpactGate?: { required: boolean; satisfied: boolean };
  changeImpactNudgeBudget?: { remaining: number };
  mustReadNudgeBudget?: { remaining: number };
  taskListRef?: TaskListRef;
  establishedFacts?: EstablishedFact[];
  loopFileReads?: LoopFileReadTracker;
  windowPolicy: WindowPolicy;
  toolCache: ToolCallCache;
  readLedger?: ReadLedger;
  budget: RunBudgetTracker;
  warnings: string[];
  reasonCodes: AgentReasonCode[];
  bus: EventBus;
  runId: string;
  evidence?: RunEvidence;
  taskListAutoAdvance: boolean;
  taskListAutoAdvanceBudget: { remaining: number };
  plan?: PlanArtifact;
  changedFiles: string[];
  mutationCheckpointIds: string[];
  approvalToken: ToolApprovalToken | undefined;
  dirtyPaths: readonly string[] | undefined;
  pinnedState: RepositoryStateReference | undefined;
  workspaceRoot: string;
  signal: AbortSignal;
};

/** Continue executeOneTool after cache/ledger short-circuits. */
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
    changeImpactNudgeBudget,
    mustReadNudgeBudget,
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

  if (
    changeImpactGate?.required &&
    !changeImpactGate.satisfied &&
    mutatingToolNames.has(toolCall.name) &&
    (changeImpactNudgeBudget?.remaining ?? 0) > 0
  ) {
    changeImpactNudgeBudget!.remaining -= 1;
    reasonCodes.push("change_impact_gate_blocked");
    reasonCodes.push("change_impact_incomplete");
    const message =
      "analyze_change_impact is required before the first mutating edit on this run (change_impact_recommended). Call analyze_change_impact on the primary seed path, then retry the mutation.";
    warnings.push(message);
    const now = runtime.isoNow();
    const result = toolResultSchema.parse({
      schemaVersion: TOOL_RUNTIME_SCHEMA_VERSION,
      callId: toolCall.id,
      toolName: toolCall.name,
      status: "rejected",
      reasonCode: "change_impact_incomplete",
      output: {
        message,
        requiredTool: "analyze_change_impact",
      },
      truncated: false,
      redacted: false,
      durationMs: 0,
      bytesProduced: 0,
      warnings: [message],
      audit: {
        callId: toolCall.id,
        toolName: toolCall.name,
        startedAt: now,
        endedAt: now,
        status: "rejected",
        reasonCode: "change_impact_incomplete",
        inputPreview: toolCall.name,
        outputPreview: message,
        bytesProduced: 0,
        durationMs: 0,
        truncated: false,
        redacted: false,
      },
    });
    toolCache.set(toolCall.id, result);
    runtime.emit(bus, {
      type: "tool_completed",
      runId,
      callId: toolCall.id,
      toolName: toolCall.name,
      status: result.status,
      ...(summary ? { summary } : {}),
      ...toolCompletionDiagnostics(result),
      at: runtime.isoNow(),
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

  if (
    changeImpactGate?.required &&
    !changeImpactGate.satisfied &&
    mutatingToolNames.has(toolCall.name)
  ) {
    warnings.push(
      "Proceeding with the mutating edit before analyze_change_impact after the change-impact nudge budget was exhausted. Prefer calling it on the primary seed when useful.",
    );
  }

  if (
    mutatingToolNames.has(toolCall.name) &&
    (mustReadNudgeBudget?.remaining ?? 0) > 0
  ) {
    const mutationPaths = extractMutationTargetPaths(
      toolCall.name,
      argumentsValue,
    );
    const missing = missingMustReadPaths({
      taskList: taskListRef?.current,
      mutationPaths,
      loopFileReads,
      establishedFacts,
    });
    if (missing.length > 0) {
      mustReadNudgeBudget!.remaining -= 1;
      reasonCodes.push("must_read_nudged");
      const message = buildMustReadNudgeMessage({
        missing,
        mutationPaths,
      });
      warnings.push(message);
      const now = runtime.isoNow();
      const result = toolResultSchema.parse({
        schemaVersion: TOOL_RUNTIME_SCHEMA_VERSION,
        callId: toolCall.id,
        toolName: toolCall.name,
        status: "rejected",
        reasonCode: "must_read_incomplete",
        output: {
          missingMustRead: missing,
          write: mutationPaths,
          message,
        },
        truncated: false,
        redacted: false,
        durationMs: 0,
        bytesProduced: 0,
        warnings: [message],
        audit: {
          callId: toolCall.id,
          toolName: toolCall.name,
          startedAt: now,
          endedAt: now,
          status: "rejected",
          reasonCode: "must_read_incomplete",
          inputPreview: toolCall.name,
          outputPreview: message,
          bytesProduced: 0,
          durationMs: 0,
          truncated: false,
          redacted: false,
        },
      });
      toolCache.set(toolCall.id, result);
      runtime.emit(bus, {
        type: "tool_completed",
        runId,
        callId: toolCall.id,
        toolName: toolCall.name,
        status: result.status,
        ...(summary ? { summary } : {}),
        ...toolCompletionDiagnostics(result),
        at: runtime.isoNow(),
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
  }

  if (isUpdateTodosTool(toolCall.name)) {
    const applied = applyUpdateTodosArguments({
      current: taskListRef?.current,
      argumentsValue,
      maxTasks: taskListRef?.maxTasks,
    });
    const result = applied.ok
      ? buildUpdateTodosToolResult({
          callId: toolCall.id,
          status: "succeeded",
          taskList: applied.taskList,
          warnings: applied.warnings,
        })
      : buildUpdateTodosToolResult({
          callId: toolCall.id,
          status: "rejected",
          reasonCode: "invalid_arguments",
          warnings: [applied.message],
        });
    if (applied.ok) {
      let nextList = applied.taskList;
      if (taskListRef && nextList) {
        const newlyDone = nextList.items.filter((item) => item.status === "done");
        recordCompletedPlanSteps(taskListRef, newlyDone);
      }
      if (nextList && plan) {
        const refilled = maybeRefillTaskListFromPlan({
          current: nextList,
          plan,
          maxTasks: taskListRef?.maxTasks,
          completedPlanStepIds: taskListRef?.completedPlanStepIds,
        });
        if (refilled.refilled && refilled.taskList) {
          nextList = refilled.taskList;
          reasonCodes.push("task_list_refilled");
        }
      }
      if (taskListRef) {
        taskListRef.current = nextList;
        markTaskListUpdated(taskListRef, budget.snapshot().modelCalls);
      }
      reasonCodes.push("task_list_updated");
      // Always emit, including clear/empty, so hosts can drop a stale checklist.
      runtime.emitTaskListUpdated(
        bus,
        runId,
        nextList ?? {
          schemaVersion: 1,
          source: "agent",
          items: [],
        },
        planProgressOf({
          plan,
          completedPlanStepIds: taskListRef?.completedPlanStepIds,
          evidence,
        }),
      );
    }
    toolCache.set(toolCall.id, result);
    runtime.emit(bus, {
      type: "tool_completed",
      runId,
      callId: toolCall.id,
      toolName: toolCall.name,
      status: result.status,
      ...(summary ? { summary } : {}),
      ...toolCompletionDiagnostics(result),
      at: runtime.isoNow(),
    });
    recordToolEvidence(evidence, {
      toolName: toolCall.name,
      status: result.status,
      summary,
      output: result.output,
      at: runtime.isoNow(),
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
    const output = result.output as
      | { fingerprint?: string; paths?: string[] }
      | undefined;
    runtime.emit(bus, {
      type: "tool_completed",
      runId,
      callId: toolCall.id,
      toolName: toolCall.name,
      status: result.status,
      ...(summary ? { summary } : {}),
      ...toolCompletionDiagnostics(result),
      at: runtime.isoNow(),
    });
    // Do not cache: resume must re-execute this call once approved.
    return {
      kind: "approval_required",
      toolName: toolCall.name,
      callId: toolCall.id,
      fingerprint:
        output?.fingerprint ?? fingerprintToolCall(toolCall.name, argumentsValue),
      arguments: argumentsValue,
      paths: output?.paths ?? [],
    };
  }

  toolCache.set(toolCall.id, result);
  if (
    result.status === "succeeded" &&
    (READ_ONLY_TOOL_IDS as readonly string[]).includes(toolCall.name)
  ) {
    const contentPaths = extractToolContentPaths(
      toolCall.name,
      argumentsValue,
    );
    toolCache.setContent(
      toolCall.name,
      argumentsValue,
      result,
      contentPaths,
    );
    readLedger?.record({
      toolName: toolCall.name,
      argumentsValue,
      preview: result.audit.outputPreview,
    });
    upsertEstablishedFact(
      establishedFacts ?? [],
        extractEstablishedFact({
          toolName: toolCall.name,
          argumentsValue,
          output: result.output,
          outputPreview: result.audit.outputPreview,
          maxChars: windowPolicy.compaction.establishedFactChars,
        }),
        { maxFacts: windowPolicy.compaction.maxEstablishedFacts },
      );
    }

  if (result.status === "succeeded") {
    if (toolCall.name === "analyze_change_impact" && changeImpactGate) {
      changeImpactGate.satisfied = true;
      reasonCodes.push("change_impact_observed");
    }
    const output = result.output as
      | { checkpointId?: string; changedFiles?: string[] }
      | undefined;
    if (output?.checkpointId) {
      mutationCheckpointIds.push(output.checkpointId);
      for (const changed of output.changedFiles ?? []) {
        if (!changedFiles.includes(changed)) {
          changedFiles.push(changed);
        }
      }
      reasonCodes.push("mutation_applied");
      toolCache.invalidateContent(output.changedFiles ?? []);
      readLedger?.invalidatePaths(output.changedFiles ?? []);
      dropEstablishedFactsForPaths(
        establishedFacts ?? [],
        output.changedFiles ?? [],
      );
    }
    const autoAdvanced = maybeAutoAdvanceTaskList({
      enabled: taskListAutoAdvance,
      allowAdvance: taskListAutoAdvanceBudget.remaining > 0,
      current: taskListRef?.current,
      preToolActiveId,
      toolStatus: result.status,
      isMutatingTool: mutatingToolNames.has(toolCall.name),
      changedFiles: output?.changedFiles ?? [],
      plan,
      maxTasks: taskListRef?.maxTasks,
      taskListRef,
    });
    if (autoAdvanced.warnings.length > 0) {
      warnings.push(...autoAdvanced.warnings);
    }
    if (autoAdvanced.advanced && autoAdvanced.taskList && taskListRef) {
      taskListRef.current = autoAdvanced.taskList;
      markTaskListUpdated(taskListRef, budget.snapshot().modelCalls);
      taskListAutoAdvanceBudget.remaining = Math.max(
        0,
        taskListAutoAdvanceBudget.remaining - 1,
      );
      reasonCodes.push("task_list_auto_advanced", "task_list_updated");
      if (autoAdvanced.refilled) {
        reasonCodes.push("task_list_refilled");
      }
      runtime.emitTaskListUpdated(
        bus,
        runId,
        autoAdvanced.taskList,
        planProgressOf({
          plan,
          completedPlanStepIds: taskListRef.completedPlanStepIds,
          evidence,
        }),
      );
      if (evidence?.plan && autoAdvanced.completedStepIds) {
        markPlanEvidenceStepsDone(evidence, autoAdvanced.completedStepIds);
      }
    }
  }

  if (result.status === "failed" || result.status === "rejected") {
    warnings.push(
      `Tool ${toolCall.name} ${result.status}${
        result.reasonCode ? ` (${result.reasonCode})` : ""
      }.`,
    );
  }

  runtime.emit(bus, {
    type: "tool_completed",
    runId,
    callId: toolCall.id,
    toolName: toolCall.name,
    status: result.status,
    ...(summary ? { summary } : {}),
    ...toolCompletionDiagnostics(result),
    at: runtime.isoNow(),
  });
  recordToolEvidence(evidence, {
    toolName: toolCall.name,
    status: result.status,
    summary,
    output: result.output,
    at: runtime.isoNow(),
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
