/**
 * Discovery-pass model/tool loop — extracted from runDiscoveryPass.
 */
import type { ModelMessage, ModelToolDefinition } from "../../../modules/model-gateway";
import type { RepositoryStateReference } from "../../../modules/repository-state";
import type { WindowPolicy } from "../../../modules/window-budget";
import type { ToolGrant } from "../../../modules/decision-policy";
import { TOOL_RUNTIME_SCHEMA_VERSION } from "../../tool-runtime";

import {
  serializeToolResultForModel,
  resolveReasoningProgressBudget,
  summarizeToolCall,
  extractFileReadPaths,
} from "../actions";
import type { DiscoveryPassBudget } from "../modules/plan-discovery";
import {
  discoveryBudgetRemaining,
  discoveryCanModelTurn,
  discoveryHasSymbolEvidence,
  extractDiscoveryReadText,
  hasDiscoveryReadPath,
  isDiscoveryToolAllowed,
  recordDiscoveryToolUse,
  type DiscoveryObservationCollector,
} from "../internal/discovery";
import { EventBus } from "../internal/EventBus";
import { RunBudgetTracker } from "../internal/RunBudget";
import type { AgentEngineRuntime } from "./runtime";
import { consumeModelTurn } from "./consumeModelTurn";
import {
  DISCOVERY_SEARCH_EVIDENCE_NUDGE,
  DISCOVERY_SYMBOL_EVIDENCE_NUDGE,
} from "./pinDiscoveryPassNudges";

export type DiscoveryPassStopReason =
  | "natural"
  | "turn_cap"
  | "budget_exhausted"
  | "aborted"
  | "model_error";

export async function runDiscoveryPassModelLoop(params: {
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
  tools: ModelToolDefinition[];
  messages: ModelMessage[];
  collector: DiscoveryObservationCollector;
  discoveryBudget: DiscoveryPassBudget;
  qualityFloor: boolean;
  preferSymbolEvidence: boolean;
  minSearches: number;
  canForceTools: boolean;
  qualityFloorNudge: string;
  preReadByPath: Map<string, string>;
  perFileChars: number;
  stopReason: DiscoveryPassStopReason;
}): Promise<DiscoveryPassStopReason> {
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
    tools,
    messages,
    collector,
    discoveryBudget,
    qualityFloor,
    preferSymbolEvidence,
    minSearches,
    canForceTools,
    qualityFloorNudge,
    preReadByPath,
    perFileChars,
  } = params;

  let stopReason = params.stopReason;
  let turn = 0;
  let qualityFloorNudged = false;
  let symbolEvidenceNudged = false;
  let searchEvidenceNudged = false;

  for (; turn < discoveryBudget.maxModelTurns; turn += 1) {
    if (signal.aborted) {
      stopReason = "aborted";
      break;
    }
    if (!discoveryCanModelTurn(collector) || !budget.canStartModelCall()) {
      stopReason = "budget_exhausted";
      break;
    }
    const needsFileEvidence =
      qualityFloor && collector.fileReads === 0 && tools.length > 0;
    const needsSymbolEvidence =
      qualityFloor &&
      preferSymbolEvidence &&
      collector.fileReads > 0 &&
      !discoveryHasSymbolEvidence(collector) &&
      tools.length > 0;
    const needsSearchEvidence =
      qualityFloor &&
      minSearches > 0 &&
      collector.searches < minSearches &&
      tools.length > 0;
    const needsForcedTools =
      canForceTools &&
      (needsFileEvidence || needsSymbolEvidence || needsSearchEvidence);
    budget.recordModelCall();
    const discoveryReasoningBudget = resolveReasoningProgressBudget({
      supportsReasoning: runtime.deps.llm.capabilities.supportsReasoning,
    });
    const turnResult = await consumeModelTurn(runtime, {
      llm: runtime.deps.llm,
      request: {
        messages: [...messages],
        tools,
        temperature: 0,
        maximumOutputTokens: 800,
        stream: false,
        toolChoice: needsForcedTools
          ? "required"
          : tools.length > 0
            ? "auto"
            : "none",
      },
      runId,
      signal,
      bus,
      maxReasoningCharsWithoutProgress: discoveryReasoningBudget.baseChars,
      tightReasoningCharsWhenChannelActive:
        discoveryReasoningBudget.tightChars,
    });
    if (turnResult.kind !== "completed") {
      stopReason = turnResult.kind === "cancelled" ? "aborted" : "model_error";
      break;
    }
    const toolCalls = turnResult.toolCalls.filter((call) =>
      isDiscoveryToolAllowed(call.name),
    );
    if (toolCalls.length === 0) {
      if (
        qualityFloor &&
        collector.fileReads === 0 &&
        !qualityFloorNudged &&
        turn + 1 < discoveryBudget.maxModelTurns
      ) {
        qualityFloorNudged = true;
        messages.push({
          role: "assistant",
          content: turnResult.content,
        });
        messages.push({
          role: "user",
          content: qualityFloorNudge,
        });
        continue;
      }
      if (
        qualityFloor &&
        preferSymbolEvidence &&
        collector.fileReads > 0 &&
        !discoveryHasSymbolEvidence(collector) &&
        !symbolEvidenceNudged &&
        turn + 1 < discoveryBudget.maxModelTurns
      ) {
        symbolEvidenceNudged = true;
        messages.push({
          role: "assistant",
          content: turnResult.content,
        });
        messages.push({
          role: "user",
          content: DISCOVERY_SYMBOL_EVIDENCE_NUDGE,
        });
        continue;
      }
      if (
        qualityFloor &&
        minSearches > 0 &&
        collector.searches < minSearches &&
        !searchEvidenceNudged &&
        turn + 1 < discoveryBudget.maxModelTurns
      ) {
        searchEvidenceNudged = true;
        messages.push({
          role: "assistant",
          content: turnResult.content,
        });
        messages.push({
          role: "user",
          content: DISCOVERY_SEARCH_EVIDENCE_NUDGE,
        });
        continue;
      }
      // Model chose to stop calling tools — a natural finish.
      break;
    }
    messages.push({
      role: "assistant",
      content: turnResult.content,
      toolCalls,
    });
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
    // All tool calls were redundant re-reads — stop instead of another empty turn.
    if (!executedFreshTool && collector.fileReads > 0) {
      break;
    }
  }
  if (stopReason === "natural" && turn >= discoveryBudget.maxModelTurns) {
    stopReason = "turn_cap";
  }
  return stopReason;
}
