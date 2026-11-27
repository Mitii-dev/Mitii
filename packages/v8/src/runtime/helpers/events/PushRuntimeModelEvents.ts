/**
 * Map runtime model/tool progress → host RunEvent (Desktop thinking / tokens).
 * Preview lengths match the RunEvent contract (model_delta.preview ≤ 500).
 */

import type { RunEvent } from "../../../engine/v8-engine/contracts";
import type {
  RuntimeModelStreamEvent,
  RuntimeModelUsage,
} from "../../ports/RuntimeModelPort";
import type { RuntimeEventSink } from "./RuntimeEventChannel";

const PREVIEW_MAX = 200;

export function pushRuntimeModelStreamEvent(
  sink: RuntimeEventSink | undefined,
  params: {
    runId: string;
    event: RuntimeModelStreamEvent;
    at?: string;
  },
): void {
  if (!sink) return;
  const at = params.at ?? new Date().toISOString();
  const { runId, event } = params;

  if (event.type === "content_delta") {
    const preview = event.content.slice(0, PREVIEW_MAX);
    if (!preview) return;
    sink.push({
      type: "model_delta",
      runId,
      kind: "content",
      preview,
      at,
    });
    return;
  }

  if (event.type === "reasoning_delta") {
    const preview = event.reasoning.slice(0, PREVIEW_MAX);
    if (!preview) return;
    sink.push({
      type: "model_delta",
      runId,
      kind: "reasoning",
      preview,
      at,
    });
    return;
  }

  if (event.type === "tool_call_delta") {
    sink.push({
      type: "model_delta",
      runId,
      kind: "tool_call",
      ...(event.toolName ? { preview: event.toolName.slice(0, PREVIEW_MAX) } : {}),
      at,
    });
  }
}

export function pushRuntimeModelTurnEvent(
  sink: RuntimeEventSink | undefined,
  params: {
    runId: string;
    turnIndex: number;
    usage?: RuntimeModelUsage;
    finishReason?: string;
    at?: string;
  },
): void {
  if (!sink) return;
  const at = params.at ?? new Date().toISOString();
  const event: RunEvent = {
    type: "model_turn",
    runId: params.runId,
    turnIndex: params.turnIndex,
    at,
    ...(params.finishReason ? { finishReason: params.finishReason } : {}),
    ...(typeof params.usage?.inputTokens === "number"
      ? { inputTokens: params.usage.inputTokens }
      : {}),
    ...(typeof params.usage?.outputTokens === "number"
      ? { outputTokens: params.usage.outputTokens }
      : {}),
    ...(typeof params.usage?.cacheHitTokens === "number"
      ? { cacheHitTokens: params.usage.cacheHitTokens }
      : {}),
    ...(typeof params.usage?.cacheMissTokens === "number"
      ? { cacheMissTokens: params.usage.cacheMissTokens }
      : {}),
  };
  sink.push(event);
}

export function pushRuntimeToolStartedEvent(
  sink: RuntimeEventSink | undefined,
  params: {
    runId: string;
    callId: string;
    toolName: string;
    /** Path/pattern/argv preview for Desktop activity + session logs. */
    summary?: string;
    at?: string;
  },
): void {
  if (!sink) return;
  const summary = params.summary?.trim().slice(0, 500);
  sink.push({
    type: "tool_started",
    runId: params.runId,
    callId: params.callId,
    toolName: params.toolName,
    ...(summary ? { summary } : {}),
    at: params.at ?? new Date().toISOString(),
  });
}

export function pushRuntimeToolCompletedEvent(
  sink: RuntimeEventSink | undefined,
  params: {
    runId: string;
    callId: string;
    toolName: string;
    status: "succeeded" | "failed" | "cancelled" | "skipped";
    summary?: string;
    reasonCode?: string;
    outputPreview?: string;
    at?: string;
  },
): void {
  if (!sink) return;
  const summary = params.summary?.trim().slice(0, 500);
  const reasonCode = params.reasonCode?.trim().slice(0, 80);
  const outputPreview = params.outputPreview?.trim().slice(0, 1_000);
  sink.push({
    type: "tool_completed",
    runId: params.runId,
    callId: params.callId,
    toolName: params.toolName,
    status: params.status,
    ...(summary ? { summary } : {}),
    ...(reasonCode ? { reasonCode } : {}),
    ...(outputPreview ? { outputPreview } : {}),
    at: params.at ?? new Date().toISOString(),
  });
}

export function mergeRuntimeModelUsage(
  into: RuntimeModelUsage,
  next: RuntimeModelUsage | undefined,
): RuntimeModelUsage {
  if (!next) return into;
  return {
    inputTokens: addOptional(into.inputTokens, next.inputTokens),
    outputTokens: addOptional(into.outputTokens, next.outputTokens),
    cacheHitTokens: addOptional(into.cacheHitTokens, next.cacheHitTokens),
    cacheMissTokens: addOptional(into.cacheMissTokens, next.cacheMissTokens),
  };
}

function addOptional(
  left: number | undefined,
  right: number | undefined,
): number | undefined {
  if (left == null && right == null) return undefined;
  return (left ?? 0) + (right ?? 0);
}
