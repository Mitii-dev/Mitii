import type {
  ToolGrant,
} from "../../../modules/decision-policy";
import {
  READ_ONLY_TOOL_IDS,
} from "../../../modules/decision-policy";
import type {
  ModelToolCall,
} from "../../../modules/model-gateway";
import type {
  PlanArtifact,
} from "../../../modules/planning";
import type {
  RepositoryStateReference,
} from "../../../modules/repository-state";
import type { WindowPolicy } from "../../../modules/window-budget";
import {
  TOOL_RUNTIME_SCHEMA_VERSION,
  fingerprintToolCall,
  toolResultSchema,
} from "../../tool-runtime";
import type { ToolApprovalToken } from "../../tool-runtime";

import {
  summarizeToolCall,
  dropEstablishedFactsForPaths,
  extractEstablishedFact,
  extractFileReadPaths,
  extractMutationTargetPaths,
  extractToolContentPaths,
  missingMustReadPaths,
  buildMustReadNudgeMessage,
  recordLoopFileReads,
  upsertEstablishedFact,
  serializeToolResultForModel,
  recordToolEvidence,
} from "../actions";
import type {
  EstablishedFact,
  LoopFileReadTracker,
} from "../actions";
import { ToolCallCache, rebaseToolResult } from "../internal/ToolCallCache";
import {
  ReadLedger,
  buildAlreadyReadToolResult,
} from "../internal/ReadLedger";
import type {
  AgentReasonCode,
  RunEvidence,
} from "../contracts";
import { EventBus } from "../internal/EventBus";
import { RunBudgetTracker } from "../internal/RunBudget";
import {
  applyUpdateTodosArguments,
  buildUpdateTodosToolResult,
  canonicalizeUpdateTodosToolName,
  isUpdateTodosTool,
  maybeAutoAdvanceTaskList,
  maybeRefillTaskListFromPlan,
  planProgressOf,
  recordCompletedPlanSteps,
  type TaskListRef,
} from "../internal/taskListRuntime";
import { markPlanEvidenceStepsDone } from "../actions/runEvidence";

import type { AgentEngineRuntime } from "./runtime";
import type {
  ToolCallOutcome,
} from "./types";

import {
  toolCompletionDiagnostics,
} from "./executeToolSupport";
export {
  DEFAULT_MUTATING_TOOL_NAMES,
  safeJsonParse,
  toolCompletionDiagnostics,
  truncateForLogField,
  refreshAuthorityAfterTools,
} from "./executeToolSupport";
export type { GrantRefreshOutcome } from "./executeToolSupport";

export async function executeOneTool(
  runtime: AgentEngineRuntime,
  params: {
  runId: string;
  toolCall: ModelToolCall;
  grant: ToolGrant;
  pinnedState: RepositoryStateReference | undefined;
  workspaceRoot: string;
  bus: EventBus;
  signal: AbortSignal;
  toolCache: ToolCallCache;
  /** Main-loop duplicate-read ledger (optional for resume/tests). */
  readLedger?: ReadLedger;
  budget: RunBudgetTracker;
  warnings: string[];
  reasonCodes: AgentReasonCode[];
  dirtyPaths: readonly string[] | undefined;
  changedFiles: string[];
  mutationCheckpointIds: string[];
  approvalToken: ToolApprovalToken | undefined;
  taskListRef?: TaskListRef;
  taskListAutoAdvance: boolean;
  /** Shared remaining auto-advances for the current model turn (usually 0 or 1). */
  taskListAutoAdvanceBudget: { remaining: number };
  mutatingToolNames: ReadonlySet<string>;
  /** Soft gate: require analyze_change_impact before first mutation when recommended. */
  changeImpactGate?: { required: boolean; satisfied: boolean };
  evidence?: RunEvidence;
  establishedFacts?: EstablishedFact[];
  windowPolicy: WindowPolicy;
  loopFileReads?: LoopFileReadTracker;
  /** One withheld mutation when active-task mustRead files are not loaded. */
  mustReadNudgeBudget?: { remaining: number };
  plan?: PlanArtifact;
}): Promise<ToolCallOutcome> {
  const {
    runId,
    toolCall: rawToolCall,
    grant,
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
    approvalToken,
    taskListRef,
    taskListAutoAdvance,
    taskListAutoAdvanceBudget,
    mutatingToolNames,
    changeImpactGate,
    evidence,
    establishedFacts,
    windowPolicy,
    loopFileReads,
    mustReadNudgeBudget,
    plan,
  } = params;

  const toolCall: ModelToolCall = {
    ...rawToolCall,
    name: canonicalizeUpdateTodosToolName(rawToolCall.name),
  };

  let argumentsValue: unknown = {};
  try {
    argumentsValue =
      toolCall.arguments.trim().length === 0
        ? {}
        : JSON.parse(toolCall.arguments);
  } catch {
    warnings.push(`Invalid JSON arguments for tool ${toolCall.name}.`);
    argumentsValue = { _raw: toolCall.arguments };
  }
  const summary = summarizeToolCall(toolCall.name, argumentsValue);
  const fileReadPaths = extractFileReadPaths(toolCall.name, argumentsValue);
  if (fileReadPaths) {
    budget.recordFileRead(fileReadPaths);
    if (loopFileReads) {
      recordLoopFileReads(loopFileReads, fileReadPaths);
    }
  }

  runtime.emit(bus, {
    type: "tool_started",
    runId,
    callId: toolCall.id,
    toolName: toolCall.name,
    ...(summary ? { summary } : {}),
    at: runtime.isoNow(),
  });

  // callId cache is resume/idempotency only. Require matching toolName so a
  // recycled provider id (e.g. Gemini historically always emitting call_0)
  // cannot replay an unrelated tool result.
  const cachedByCallIdRaw = toolCache.get(toolCall.id);
  const cachedByCallId =
    cachedByCallIdRaw && cachedByCallIdRaw.toolName === toolCall.name
      ? cachedByCallIdRaw
      : undefined;
  const cachedByContent =
    cachedByCallId === undefined &&
    (READ_ONLY_TOOL_IDS as readonly string[]).includes(toolCall.name)
      ? toolCache.getByContent(toolCall.name, argumentsValue)
      : undefined;
  const cached =
    cachedByCallId ??
    (cachedByContent && cachedByContent.status === "succeeded"
      ? rebaseToolResult(cachedByContent, toolCall.id)
      : undefined);
  if (cached) {
    if (cachedByContent && cachedByCallId === undefined) {
      toolCache.set(toolCall.id, cached);
      reasonCodes.push("tool_result_deduped");
      upsertEstablishedFact(
        establishedFacts ?? [],
        extractEstablishedFact({
          toolName: toolCall.name,
          argumentsValue,
          output: cached.output,
          outputPreview: cached.audit.outputPreview,
          maxChars: windowPolicy.compaction.establishedFactChars,
        }),
        { maxFacts: windowPolicy.compaction.maxEstablishedFacts },
      );
    }
    runtime.emit(bus, {
      type: "tool_completed",
      runId,
      callId: toolCall.id,
      toolName: toolCall.name,
      status: cached.status,
      ...(summary ? { summary } : {}),
      ...toolCompletionDiagnostics(cached),
      at: runtime.isoNow(),
    });
    return {
      kind: "message",
      message: {
        role: "tool",
        toolCallId: toolCall.id,
        content: serializeToolResultForModel(cached, {
          maxContentChars: windowPolicy.compaction.toolResultContentChars,
        }),
      },
    };
  }

  if (
    readLedger &&
    ReadLedger.isLedgerTool(toolCall.name)
  ) {
    const ledgerEntry = readLedger.lookup({
      toolName: toolCall.name,
      argumentsValue,
    });
    if (ledgerEntry) {
      reasonCodes.push("tool_result_already_read");
      const alreadyRead = buildAlreadyReadToolResult({
        callId: toolCall.id,
        toolName: toolCall.name,
        entry: ledgerEntry,
        nowIso: runtime.isoNow(),
      });
      toolCache.set(toolCall.id, alreadyRead);
      runtime.emit(bus, {
        type: "tool_completed",
        runId,
        callId: toolCall.id,
        toolName: toolCall.name,
        status: alreadyRead.status,
        ...(summary ? { summary } : {}),
        ...toolCompletionDiagnostics(alreadyRead),
        at: runtime.isoNow(),
      });
      return {
        kind: "message",
        message: {
          role: "tool",
          toolCallId: toolCall.id,
          content: serializeToolResultForModel(alreadyRead, {
            maxContentChars: windowPolicy.compaction.toolResultContentChars,
          }),
        },
      };
    }
  }

  budget.recordToolCall();
  const preToolActiveId = taskListRef?.current?.items.find(
    (item) => item.status === "active",
  )?.id;

  if (
    changeImpactGate?.required &&
    !changeImpactGate.satisfied &&
    mutatingToolNames.has(toolCall.name)
  ) {
    warnings.push(
      "Proceeding with the mutating edit before analyze_change_impact. Call it on the primary seed when useful; do not block the batch.",
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
