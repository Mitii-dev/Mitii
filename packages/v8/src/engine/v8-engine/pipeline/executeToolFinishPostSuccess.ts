/**
 * Post-execute success / approval handling for finishExecuteOneTool.
 */
import { READ_ONLY_TOOL_IDS } from "../../../modules/decision-policy";
import type { ModelToolCall } from "../../../modules/model-gateway";
import type { PlanArtifact } from "../../../modules/planning";
import type { WindowPolicy } from "../../../modules/window-budget";
import { fingerprintToolCall } from "../../tool-runtime";
import type { ToolResult } from "../../tool-runtime";

import {
  applySucceededMutationSideEffects,
  extractEstablishedFact,
  extractToolContentPaths,
  upsertEstablishedFact,
  recordToolEvidence,
} from "../actions";
import type { EstablishedFact, LoopFileReadTracker } from "../actions";
import type { ToolCallCache } from "../internal/ToolCallCache";
import type { ReadLedger } from "../internal/ReadLedger";
import type { AgentReasonCode, RunEvidence } from "../contracts";
import type { EventBus } from "../internal/EventBus";
import type { RunBudgetTracker } from "../internal/RunBudget";
import type { TaskListRef } from "../internal/taskListRuntime";
import type { ToolCallOutcome } from "./types";
import { toolCompletionDiagnostics } from "./executeToolSupport";
import { markReadCoverageFromToolResult } from "./executeToolFinishHelpers";
import { maybeAutoAdvanceAfterSucceededTool } from "./executeToolFinishAutoAdvance";
import type { AgentEngineRuntime } from "./runtime";

export function approvalRequiredOutcome(params: {
  runtime: AgentEngineRuntime;
  bus: EventBus;
  runId: string;
  toolCall: ModelToolCall;
  argumentsValue: unknown;
  summary: string | undefined;
  result: ToolResult;
}): ToolCallOutcome {
  const { runtime, bus, runId, toolCall, argumentsValue, summary, result } =
    params;
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
      output?.fingerprint ??
      fingerprintToolCall(toolCall.name, argumentsValue),
    arguments: argumentsValue,
    paths: output?.paths ?? [],
  };
}

export function cacheSucceededReadonlyTool(params: {
  toolCall: ModelToolCall;
  argumentsValue: unknown;
  result: ToolResult;
  toolCache: ToolCallCache;
  readLedger?: ReadLedger;
  loopFileReads?: LoopFileReadTracker;
  establishedFacts?: EstablishedFact[];
  windowPolicy: WindowPolicy;
}): void {
  const {
    toolCall,
    argumentsValue,
    result,
    toolCache,
    readLedger,
    loopFileReads,
    establishedFacts,
    windowPolicy,
  } = params;
  if (!(READ_ONLY_TOOL_IDS as readonly string[]).includes(toolCall.name)) {
    return;
  }
  const contentPaths = extractToolContentPaths(toolCall.name, argumentsValue);
  toolCache.setContent(toolCall.name, argumentsValue, result, contentPaths);
  readLedger?.record({
    toolName: toolCall.name,
    argumentsValue,
    preview: result.audit.outputPreview,
  });
  if (loopFileReads) {
    markReadCoverageFromToolResult(
      loopFileReads,
      toolCall.name,
      result.output,
      result.truncated === true,
    );
  }
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

export function applySucceededToolSideEffects(params: {
  runtime: AgentEngineRuntime;
  bus: EventBus;
  runId: string;
  toolCall: ModelToolCall;
  result: ToolResult;
  changeImpactGate?: {
    required: boolean;
    satisfied: boolean;
    lastImpactAffectedFiles?: string[];
    lastWidenVerification?: boolean;
  };
  mutationCheckpointIds: string[];
  changedFiles: string[];
  toolCache: ToolCallCache;
  readLedger?: ReadLedger;
  establishedFacts?: EstablishedFact[];
  reasonCodes: AgentReasonCode[];
  warnings: string[];
  taskListAutoAdvance: boolean;
  taskListAutoAdvanceBudget: { remaining: number };
  taskListRef?: TaskListRef;
  preToolActiveId: string | undefined;
  mutatingToolNames: ReadonlySet<string>;
  plan?: PlanArtifact;
  budget: RunBudgetTracker;
  evidence?: RunEvidence;
}): void {
  const {
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
  } = params;

  if (
    (toolCall.name === "analyze_change_impact" ||
      toolCall.name === "plan_check_change_impact") &&
    changeImpactGate
  ) {
    changeImpactGate.satisfied = true;
    reasonCodes.push("change_impact_observed");
    const impactOutput = result.output as
      | {
          affectedFiles?: Array<{ path?: string }>;
          widenVerification?: boolean;
        }
      | undefined;
    const paths = (impactOutput?.affectedFiles ?? [])
      .map((file) => file.path)
      .filter(
        (path): path is string => typeof path === "string" && path.length > 0,
      );
    if (paths.length > 0) {
      changeImpactGate.lastImpactAffectedFiles = paths;
    }
    if (typeof impactOutput?.widenVerification === "boolean") {
      changeImpactGate.lastWidenVerification = impactOutput.widenVerification;
    }
  }

  const output = result.output as
    | { checkpointId?: string; changedFiles?: string[] }
    | undefined;
  applySucceededMutationSideEffects({
    toolName: toolCall.name,
    output,
    mutationCheckpointIds,
    changedFiles,
    toolCache,
    readLedger,
    establishedFacts,
    reasonCodes,
  });

  maybeAutoAdvanceAfterSucceededTool({
    runtime,
    bus,
    runId,
    toolCall,
    result,
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

export function emitToolCompletedAndRecord(params: {
  runtime: AgentEngineRuntime;
  bus: EventBus;
  runId: string;
  toolCall: ModelToolCall;
  result: ToolResult;
  summary: string | undefined;
  evidence?: RunEvidence;
}): void {
  const { runtime, bus, runId, toolCall, result, summary, evidence } = params;
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
}
