import type { ToolGrant } from "../../../modules/decision-policy";
import type { RepositoryStateReference } from "../../../modules/repository-state";
import type { WindowPolicy } from "../../../modules/window-budget";
import { TOOL_RUNTIME_SCHEMA_VERSION } from "../../tool-runtime";

import {
  summarizeToolCall,
  extractFileReadPaths,
} from "../actions";
import { EventBus } from "../internal/EventBus";
import { RunBudgetTracker } from "../internal/RunBudget";
import {
  recordDiscoveryToolUse,
  type DiscoveryObservationCollector,
} from "../internal/discovery";
import type { AgentEngineRuntime } from "./runtime";

export async function executeDiscoveryToolCall(
  runtime: AgentEngineRuntime,
  params: {
    runId: string;
    bus: EventBus;
    budget: RunBudgetTracker;
    collector: DiscoveryObservationCollector;
    grant: ToolGrant;
    workspaceRoot: string;
    pinnedState: RepositoryStateReference | undefined;
    windowPolicy: WindowPolicy;
    toolName: string;
    argumentsValue: Record<string, unknown>;
    callIdPrefix?: string;
  },
): Promise<{ status: string; output?: unknown } | undefined> {
  const callId = `${params.callIdPrefix ?? "discovery"}-${params.collector.toolCalls + 1}`;
  const summary = summarizeToolCall(params.toolName, params.argumentsValue);
  runtime.emit(params.bus, {
    type: "tool_started",
    runId: params.runId,
    callId,
    toolName: params.toolName,
    ...(summary ? { summary } : {}),
    at: runtime.isoNow(),
  });
  params.budget.recordToolCall();
  const result = runtime.deps.tools
    ? await runtime.deps.tools.execute(
        {
          schemaVersion: TOOL_RUNTIME_SCHEMA_VERSION,
          callId,
          toolName: params.toolName,
          arguments: params.argumentsValue,
          grant: params.grant,
          workspaceRoot: params.workspaceRoot,
          pinnedState: params.pinnedState,
        },
        {
          maxContentChars: params.windowPolicy.compaction.toolResultContentChars,
        },
      )
    : undefined;
  const status = result?.status ?? "failed";
  recordDiscoveryToolUse({
    collector: params.collector,
    toolName: params.toolName,
    argumentsValue: params.argumentsValue,
    resultOutput: result?.output,
    status,
  });
  const readPaths = extractFileReadPaths(params.toolName, params.argumentsValue);
  if (readPaths && status === "succeeded") {
    params.budget.recordFileRead(readPaths);
  }
  runtime.emit(params.bus, {
    type: "tool_completed",
    runId: params.runId,
    callId,
    toolName: params.toolName,
    status,
    ...(summary ? { summary } : {}),
    at: runtime.isoNow(),
  });
  runtime.emit(params.bus, {
    type: "discovery_progress",
    runId: params.runId,
    filesRead: params.collector.fileReads,
    searches: params.collector.searches,
    ...(summary ? { summary } : {}),
    at: runtime.isoNow(),
  });
  return result ? { status: result.status, output: result.output } : undefined;
}
