/**
 * Reject a tool call that is outside the mutate-lock allowlist.
 */
import type { ModelMessage, ModelToolCall } from "../../../modules/model-gateway";
import type { WindowPolicy } from "../../../modules/window-budget";

import type { AgentReasonCode } from "../contracts";
import { summarizeToolCall } from "../actions/summarizeToolCall";
import { serializeToolResultForModel } from "../actions/serializeToolResultForModel";
import type { EventBus } from "../internal/EventBus";
import type { RunBudgetTracker } from "../internal/RunBudget";
import type { ToolCallCache } from "../internal/ToolCallCache";
import type { ToolResult } from "../../tool-runtime";
import { TOOL_RUNTIME_SCHEMA_VERSION } from "../../tool-runtime";
import type { ToolLoopResult } from "../modules/tool-loop-guard";
import type { AgentEngineRuntime } from "./runtime";

export function rejectMutateLockBlockedTool(params: {
  runtime: AgentEngineRuntime;
  bus: EventBus;
  runId: string;
  toolCall: ModelToolCall;
  mutateLockAllowTargetedReads: boolean;
  budget: RunBudgetTracker;
  toolCache: ToolCallCache;
  messages: ModelMessage[];
  reasonCodes: AgentReasonCode[];
  warnings: string[];
  windowPolicy: WindowPolicy;
  results: ToolLoopResult[];
}): void {
  const {
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
  } = params;

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
}
