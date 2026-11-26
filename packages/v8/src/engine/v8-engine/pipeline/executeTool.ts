import type { ToolGrant } from "../../../modules/decision-policy";
import type { ModelToolCall } from "../../../modules/model-gateway";
import type { PlanArtifact } from "../../../modules/planning";
import type { RepositoryStateReference } from "../../../modules/repository-state";
import type { WindowPolicy } from "../../../modules/window-budget";
import type { ToolApprovalToken } from "../../tool-runtime";

import {
  summarizeToolCall,
  extractFileReadPaths,
  recordLoopFileReads,
} from "../actions";
import type { EstablishedFact, LoopFileReadTracker } from "../actions";
import type { ToolCallCache } from "../internal/ToolCallCache";
import type { ReadLedger } from "../internal/ReadLedger";
import type { AgentReasonCode, RunEvidence } from "../contracts";
import type { EventBus } from "../internal/EventBus";
import type { RunBudgetTracker } from "../internal/RunBudget";
import {
  canonicalizeUpdateTodosToolName,
  type TaskListRef,
} from "../internal/taskListRuntime";

import type { AgentEngineRuntime } from "./runtime";
import type { ToolCallOutcome } from "./types";

import { finishExecuteOneTool } from "./executeToolFinish";
import { resolveExecuteToolCacheHit } from "./executeToolCacheHits";
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
    changeImpactGate?: {
      required: boolean;
      satisfied: boolean;
      lastImpactAffectedFiles?: string[];
      lastWidenVerification?: boolean;
    };
    /** Remaining change-impact withholdals for this run (usually 0 or 1). */
    changeImpactNudgeBudget?: { remaining: number };
    evidence?: RunEvidence;
    establishedFacts?: EstablishedFact[];
    windowPolicy: WindowPolicy;
    loopFileReads?: LoopFileReadTracker;
    /** One withheld mutation when active-task mustRead files are not loaded. */
    mustReadNudgeBudget?: { remaining: number };
    plan?: PlanArtifact;
  },
): Promise<ToolCallOutcome> {
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

  const cacheHit = resolveExecuteToolCacheHit({
    runtime,
    runId,
    bus,
    toolCall,
    argumentsValue,
    summary,
    toolCache,
    readLedger,
    reasonCodes,
    establishedFacts,
    windowPolicy,
  });
  if (cacheHit) {
    return cacheHit;
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
