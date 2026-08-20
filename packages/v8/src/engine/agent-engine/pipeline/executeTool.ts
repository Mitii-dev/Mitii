import type {
  ExecutionDecision,
  ToolGrant,
} from "../../../modules/decision-policy";
import {
  READ_ONLY_TOOL_IDS,
  toolGrantsEquivalent,
} from "../../../modules/decision-policy";
import type {
  ModelMessage,
  ModelToolCall,
} from "../../../modules/model-gateway";
import type {
  PlanArtifact,
} from "../../../modules/planning";
import type {
  ProjectDescriptor,
  RepositoryStateReference,
} from "../../../modules/repository-state";
import type { WindowPolicy } from "../../../modules/window-budget";
import type {
  RequestUnderstandingResult,
} from "../../../modules/request-understanding";
import { SKILLS_SCHEMA_VERSION } from "../../../modules/skills";
import {
  TOOL_RUNTIME_SCHEMA_VERSION,
  fingerprintToolCall,
  toolResultSchema,
} from "../../tool-runtime";
import type { ToolApprovalToken, ToolResult } from "../../tool-runtime";

import {
  summarizeToolCall,
  dropEstablishedFactsForPaths,
  extractEstablishedFact,
  extractFileReadPaths,
  extractMutationTargetPaths,
  missingMustReadPaths,
  buildMustReadNudgeMessage,
  recordLoopFileReads,
  upsertEstablishedFact,
  mapUnderstandingToSkillEvidence,
  serializeToolResultForModel,
  recordToolEvidence,
  formatSkillPromptContent,
} from "../actions";
import type {
  EstablishedFact,
  LoopFileReadTracker,
} from "../actions";
import { ToolCallCache, rebaseToolResult } from "../internal/ToolCallCache";
import type {
  AgentReasonCode,
  RunEvidence,
  RunEvent,
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
import {
  DEFAULT_MUTATION_TOOL_DEFINITIONS,
} from "../policy";

import type { AgentEngineRuntime } from "./runtime";
import type {
  ToolCallOutcome,
} from "./types";

export const DEFAULT_MUTATING_TOOL_NAMES = new Set(
  DEFAULT_MUTATION_TOOL_DEFINITIONS.map((tool) => tool.name),
);

export function safeJsonParse(value: string): unknown {
  try {
    return value.trim().length > 0 ? JSON.parse(value) : {};
  } catch {
    return {};
  }
}

export function toolCompletionDiagnostics(
  result: ToolResult,
): Partial<Extract<RunEvent, { type: "tool_completed" }>> {
  const warnings = result.warnings
    .map((warning) => truncateForLogField(warning, 500))
    .filter((warning) => warning.length > 0)
    .slice(0, 5);
  const outputPreview = result.audit.outputPreview
    ? truncateForLogField(result.audit.outputPreview, 1_000)
    : undefined;

  return {
    ...(result.reasonCode ? { reasonCode: result.reasonCode } : {}),
    ...(warnings.length > 0 ? { warnings } : {}),
    ...(outputPreview ? { outputPreview } : {}),
    durationMs: result.durationMs,
    bytesProduced: result.bytesProduced,
    truncated: result.truncated,
    redacted: result.redacted,
  };
}

export function truncateForLogField(value: string, maxChars: number): string {
  const compact = value.replace(/\s+/g, " ").trim();
  if (compact.length <= maxChars) {
    return compact;
  }
  return `${compact.slice(0, Math.max(0, maxChars - 1))}…`;
}

export async function refreshAuthorityAfterTools(
  runtime: AgentEngineRuntime,
  params: {
  runId: string;
  bus: EventBus;
  reasonCodes: AgentReasonCode[];
  warnings: string[];
  messages: ModelMessage[];
  decisionRef: {
    get: () => ExecutionDecision;
    set: (decision: ExecutionDecision) => void;
  };
  selectedSkillIdsRef: {
    get: () => string[];
    set: (ids: string[]) => void;
  };
  changedFiles: readonly string[];
  dirtyPaths: readonly string[] | undefined;
  extraPaths?: readonly string[];
  understanding?: RequestUnderstandingResult;
  skillsQuery?: string;
  mode?: "ask" | "plan" | "agent";
  projects?: readonly ProjectDescriptor[];
  route: ExecutionDecision["route"];
  windowPolicy: WindowPolicy;
}): Promise<void> {
  const discoveredPaths = [
    ...new Set([
      ...(params.dirtyPaths ?? []),
      ...params.changedFiles,
    ]),
  ]
    .filter((path) => path.trim().length > 0)
    .slice(0, 50);

  if (runtime.deps.decision.narrow && discoveredPaths.length > 0) {
    const previous = params.decisionRef.get();
    const narrowed = runtime.deps.decision.narrow({
      previous,
      discoveredPaths,
      residualRisk: params.understanding?.taskAnalysis.risk,
    });
    if (!toolGrantsEquivalent(previous.toolGrant, narrowed.toolGrant)) {
      params.decisionRef.set(narrowed);
      params.reasonCodes.push("grant_narrowed");
      runtime.emit(params.bus, {
        type: "grant_narrowed",
        runId: params.runId,
        maximumWorkspaceEffect: narrowed.toolGrant.maximumWorkspaceEffect,
        approvalMode: narrowed.toolGrant.approvalMode,
        pathScopes: narrowed.toolGrant.pathScopes.slice(0, 20),
        reasonCodes: narrowed.reasonCodes.slice(-8),
        truncated:
          narrowed.toolGrant.pathScopes.length > 20 ||
          narrowed.reasonCodes.length > 8
            ? true
            : undefined,
        at: runtime.isoNow(),
      });
    }
  }

  const extraPaths = [...new Set(params.extraPaths ?? [])].filter(
    (path) => path.trim().length > 0,
  );
  if (runtime.deps.decision.widen && extraPaths.length > 0) {
    const previous = params.decisionRef.get();
    const widened = runtime.deps.decision.widen({
      previous,
      extraPaths,
    });
    if (!toolGrantsEquivalent(previous.toolGrant, widened.toolGrant)) {
      params.decisionRef.set(widened);
      params.reasonCodes.push("grant_expanded");
      runtime.emit(params.bus, {
        type: "grant_narrowed",
        runId: params.runId,
        maximumWorkspaceEffect: widened.toolGrant.maximumWorkspaceEffect,
        approvalMode: widened.toolGrant.approvalMode,
        pathScopes: widened.toolGrant.pathScopes.slice(0, 20),
        reasonCodes: widened.reasonCodes.slice(-8),
        truncated:
          widened.toolGrant.pathScopes.length > 20 ||
          widened.reasonCodes.length > 8
            ? true
            : undefined,
        at: runtime.isoNow(),
      });
    }
  }

  if (
    !runtime.deps.skills ||
    !params.understanding ||
    !params.skillsQuery ||
    !params.mode ||
    discoveredPaths.length === 0
  ) {
    return;
  }

  const evidence = mapUnderstandingToSkillEvidence(params.understanding, {
    projects: params.projects,
    extraPaths: discoveredPaths,
  });
  const skillsResult = await runtime.deps.skills.select({
    schemaVersion: SKILLS_SCHEMA_VERSION,
    query: params.skillsQuery,
    mode: params.mode,
    route: params.route,
    budgetTokens: params.windowPolicy.skills.budgetTokens,
    maxSkills: params.windowPolicy.skills.maxSkills,
    evidence,
  });
  const nextIds = skillsResult.instructions.map((block) => block.id);
  const previousIds = params.selectedSkillIdsRef.get();
  const changed =
    nextIds.length !== previousIds.length ||
    nextIds.some((id, index) => id !== previousIds[index]);
  if (!changed || skillsResult.instructions.length === 0) {
    return;
  }

  params.selectedSkillIdsRef.set(nextIds);
  params.reasonCodes.push("skills_refreshed");
  const refreshContent = skillsResult.instructions
    .map((block) => {
      const body = formatSkillPromptContent(block);
      return `### ${block.title ?? block.id}\n${body}`;
    })
    .join("\n\n");
  params.messages.push({
    role: "user",
    content: `Updated skill guidance after discovery (follow within current tool grant):\n\n${refreshContent}`,
  });
  runtime.emit(params.bus, {
    type: "skills_ready",
    runId: params.runId,
    selectedCount: skillsResult.instructions.length,
    omittedCount: skillsResult.omissions.length,
    status: skillsResult.status,
    selected: nextIds.slice(0, 20),
    omitted: skillsResult.omissions
      .map((omission) => omission.skillId)
      .slice(0, 20),
    omittedDetails: skillsResult.omissions
      .map((omission) => ({
        id: omission.skillId,
        reason: omission.reason,
        ...(typeof omission.tokens === "number"
          ? { tokens: omission.tokens }
          : {}),
      }))
      .slice(0, 20),
    at: runtime.isoNow(),
  });
}

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

  const cachedByCallId = toolCache.get(toolCall.id);
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
    toolCache.setContent(toolCall.name, argumentsValue, result);
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
      toolCache.invalidateContent();
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
