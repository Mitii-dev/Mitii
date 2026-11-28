/**
 * Execute discovery-pass tool calls for one model turn.
 */
import type { ModelMessage, ModelToolCall } from "../../../modules/model-gateway";
import type { RepositoryStateReference } from "../../../modules/repository-state";
import type { WindowPolicy } from "../../../modules/window-budget";
import type { ToolGrant } from "../../../modules/decision-policy";
import { TOOL_RUNTIME_SCHEMA_VERSION } from "../../tool-runtime";

import {
  serializeToolResultForModel,
  summarizeToolCall,
  extractFileReadPaths,
} from "../actions";
import {
  discoveryBudgetRemaining,
  extractDiscoveryReadText,
  hasDiscoveryReadPath,
  recordDiscoveryToolUse,
  type DiscoveryObservationCollector,
} from "../internal/discovery";
import type { EventBus } from "../internal/EventBus";
import type { RunBudgetTracker } from "../internal/RunBudget";
import type { AgentEngineRuntime } from "./runtime";

export async function executeDiscoveryPassToolBatch(params: {
  runtime: AgentEngineRuntime;
  runId: string;
  bus: EventBus;
  signal: AbortSignal;
  budget: RunBudgetTracker;
  warnings: string[];
  windowPolicy: WindowPolicy;
  workspaceRoot: string;
  pinnedState: RepositoryStateReference | undefined;
  grant: ToolGrant;
  messages: ModelMessage[];
  toolCalls: readonly ModelToolCall[];
  collector: DiscoveryObservationCollector;
  preReadByPath: Map<string, string>;
  perFileChars: number;
}): Promise<{ executedFreshTool: boolean }> {
  const {
    runtime,
    runId,
    bus,
    signal,
    budget,
    warnings,
    windowPolicy,
    workspaceRoot,
    pinnedState,
    grant,
    messages,
    toolCalls,
    collector,
    preReadByPath,
    perFileChars,
  } = params;

  let executedFreshTool = false;
  for (const toolCall of toolCalls) {
    if (!discoveryBudgetRemaining(collector) || signal.aborted) {
      break;
    }
    let argumentsValue: unknown = {};
    try {
      argumentsValue =
        toolCall.arguments.trim().length === 0
          ? {}
          : JSON.parse(toolCall.arguments);
    } catch {
      argumentsValue = {};
      warnings.push(`Invalid JSON arguments for tool ${toolCall.name}.`);
    }
    const summary = summarizeToolCall(toolCall.name, argumentsValue);
    const readPath =
      typeof (argumentsValue as { path?: unknown }).path === "string"
        ? (argumentsValue as { path: string }).path
        : undefined;
    const normalizedReadPath = readPath
      ? readPath.replace(/\\/g, "/").replace(/^\.\//, "")
      : undefined;
    if (
      normalizedReadPath &&
      (toolCall.name === "read_file" || toolCall.name === "read_many_files") &&
      hasDiscoveryReadPath(collector, normalizedReadPath)
    ) {
      const cached = preReadByPath.get(normalizedReadPath);
      messages.push({
        role: "tool",
        toolCallId: toolCall.id,
        content: cached
          ? `Already read during discovery (cached content for ${normalizedReadPath}):\n${cached}`
          : `Already read during discovery: ${normalizedReadPath}. Content was provided in <pre_read_evidence>; do not re-read it.`,
      });
      continue;
    }
    executedFreshTool = true;
    runtime.emit(bus, {
      type: "tool_started",
      runId,
      callId: toolCall.id,
      toolName: toolCall.name,
      ...(summary ? { summary } : {}),
      at: runtime.isoNow(),
    });
    budget.recordToolCall();
    const result = runtime.deps.tools
      ? await runtime.deps.tools.execute(
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
            maxContentChars: windowPolicy.compaction.toolResultContentChars,
          },
        )
      : undefined;
    const status = result?.status ?? "failed";
    recordDiscoveryToolUse({
      collector,
      toolName: toolCall.name,
      argumentsValue,
      resultOutput: result?.output,
      status,
    });
    const readPaths = extractFileReadPaths(toolCall.name, argumentsValue);
    if (readPaths && status === "succeeded") {
      budget.recordFileRead(readPaths);
      const text = extractDiscoveryReadText(result?.output);
      const rawPath =
        typeof (argumentsValue as { path?: unknown }).path === "string"
          ? (argumentsValue as { path: string }).path
          : readPaths[0]?.replace(/:\d+(?:-\d+)?$/, "");
      if (text.length > 0 && rawPath) {
        preReadByPath.set(
          rawPath.replace(/\\/g, "/").replace(/^\.\//, ""),
          text.slice(0, perFileChars),
        );
      }
    }
    runtime.emit(bus, {
      type: "tool_completed",
      runId,
      callId: toolCall.id,
      toolName: toolCall.name,
      status,
      ...(summary ? { summary } : {}),
      at: runtime.isoNow(),
    });
    runtime.emit(bus, {
      type: "discovery_progress",
      runId,
      filesRead: collector.fileReads,
      searches: collector.searches,
      ...(summary ? { summary } : {}),
      at: runtime.isoNow(),
    });
    messages.push({
      role: "tool",
      toolCallId: toolCall.id,
      content: result
        ? serializeToolResultForModel(result, {
            maxContentChars: windowPolicy.compaction.toolResultContentChars,
          })
        : "Tool runtime unavailable.",
    });
  }
  return { executedFreshTool };
}
