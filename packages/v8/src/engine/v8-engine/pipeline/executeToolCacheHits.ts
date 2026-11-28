/**
 * Resolve callId/content cache + read-ledger hits before live tool execution.
 */
import { READ_ONLY_TOOL_IDS } from "../../../modules/decision-policy";
import type { ModelToolCall } from "../../../modules/model-gateway";
import type { WindowPolicy } from "../../../modules/window-budget";

import {
  extractEstablishedFact,
  serializeToolResultForModel,
  upsertEstablishedFact,
  type EstablishedFact,
} from "../actions";
import type { AgentReasonCode } from "../contracts";
import type { EventBus } from "../internal/EventBus";
import {
  ReadLedger,
  buildAlreadyReadToolResult,
} from "../internal/ReadLedger";
import { ToolCallCache, rebaseToolResult } from "../internal/ToolCallCache";
import type { AgentEngineRuntime } from "./runtime";
import type { ToolCallOutcome } from "./types";
import { toolCompletionDiagnostics } from "./executeToolSupport";

export function resolveExecuteToolCacheHit(params: {
  runtime: AgentEngineRuntime;
  runId: string;
  bus: EventBus;
  toolCall: ModelToolCall;
  argumentsValue: unknown;
  summary: string | undefined;
  toolCache: ToolCallCache;
  readLedger: ReadLedger | undefined;
  reasonCodes: AgentReasonCode[];
  establishedFacts: EstablishedFact[] | undefined;
  windowPolicy: WindowPolicy;
}): ToolCallOutcome | undefined {
  const {
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
  } = params;

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

  if (readLedger && ReadLedger.isLedgerTool(toolCall.name)) {
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

  return undefined;
}
