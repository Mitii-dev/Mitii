import {
  READ_ONLY_TOOL_IDS,
} from "../../../modules/decision-policy";
import type {
  ToolGrant,
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
import type { ToolApprovalToken } from "../../tool-runtime";

import {
  summarizeToolCall,
  extractEstablishedFact,
  extractFileReadPaths,
  recordLoopFileReads,
  upsertEstablishedFact,
  serializeToolResultForModel,
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
  canonicalizeUpdateTodosToolName,
  type TaskListRef,
} from "../internal/taskListRuntime";

import type { AgentEngineRuntime } from "./runtime";
import type {
  ToolCallOutcome,
} from "./types";

import {
  toolCompletionDiagnostics,
} from "./executeToolSupport";
import { finishExecuteOneTool } from "./executeToolFinish";
export {
  DEFAULT_MUTATING_TOOL_NAMES,
  GIT_WRITE_TOOL_NAMES,
  isGitWriteToolName,
  safeJsonParse,
  toolCompletionDiagnostics,
  truncateForLogField,
  extractHostsFromWebSearchOutput,
  expandRelatedNetworkHosts,
  inferPackageRegistryHostsFromQuery,
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
  /**
   * Soft-then-hard gate: withhold the first mutating tool call when
   * change_impact_recommended until analyze_change_impact succeeds, subject
   * to changeImpactNudgeBudget (mirrors must-read nudges).
   */
  changeImpactGate?: { required: boolean; satisfied: boolean };
  /** Remaining change-impact withholdals for this run (usually 0 or 1). */
  changeImpactNudgeBudget?: { remaining: number };
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
    changeImpactNudgeBudget,
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

  return finishExecuteOneTool(runtime, {
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
  });
}
