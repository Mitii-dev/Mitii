import type {
  LlmPort,
  ModelEvent,
  ModelRequest,
  ModelToolCall,
  ModelToolCallDelta,
} from "../../../modules/model-gateway";

import { assembleToolCalls } from "../actions";
import {
  isMidWorkAnalysisDump,
  isUnfinishedInvestigationAnswer,
} from "../actions/isIncompleteAssistantTurn";
import { AGENT_ENGINE_THRESHOLDS } from "../policy";
import { EventBus } from "../internal/EventBus";

import type { AgentEngineRuntime } from "./runtime";

export async function consumeModelTurn(
  runtime: AgentEngineRuntime,
  params: {
    llm: LlmPort;
    request: ModelRequest;
    runId: string;
    signal: AbortSignal;
    bus: EventBus;
    /**
     * Soft cap on reasoning-only streaming before treating the turn as a
     * length stop so recovery / mutation nudges can run.
     */
    maxReasoningCharsWithoutProgress?: number;
  },
): Promise<
  | {
      kind: "completed";
      content: string;
      toolCalls: ModelToolCall[];
      usage?: {
        inputTokens?: number;
        outputTokens?: number;
        cacheHitTokens?: number;
        cacheMissTokens?: number;
      };
      finishReason?: string;
      /** True when the turn was cut short by the reasoning progress budget. */
      reasoningBudgetExceeded?: boolean;
    }
  | { kind: "cancelled" }
  | {
      kind: "failed";
      content: string;
      errorCode: string;
      errorMessage: string;
    }
> {
  const { llm, request, runId, signal, bus } = params;
  const maxReasoningChars =
    params.maxReasoningCharsWithoutProgress ??
    AGENT_ENGINE_THRESHOLDS.maxReasoningCharsWithoutProgress;
  const contentParts: string[] = [];
  const reasoningParts: string[] = [];
  const toolDeltas: ModelToolCallDelta[] = [];
  let usage:
    | {
        inputTokens?: number;
        outputTokens?: number;
        cacheHitTokens?: number;
        cacheMissTokens?: number;
      }
    | undefined;
  let finishReason: string | undefined;
  let reasoningBudgetExceeded = false;
  const turnAbort = new AbortController();
  const abortSignal =
    typeof AbortSignal.any === "function"
      ? AbortSignal.any([signal, turnAbort.signal])
      : signal;

  const reasoningLength = (): number => {
    let total = 0;
    for (const part of reasoningParts) {
      total += part.length;
    }
    return total;
  };

  const tripReasoningBudget = (): void => {
    if (reasoningBudgetExceeded) {
      return;
    }
    if (contentParts.length > 0 || toolDeltas.length > 0) {
      return;
    }
    if (reasoningLength() < maxReasoningChars) {
      return;
    }
    reasoningBudgetExceeded = true;
    try {
      turnAbort.abort();
    } catch {
      // ignore
    }
  };

  try {
    for await (const event of llm.complete(request, {
      runId,
      abortSignal,
    })) {
      if (signal.aborted) {
        return { kind: "cancelled" };
      }
      if (reasoningBudgetExceeded) {
        break;
      }
      forwardModelEvent(runtime, bus, runId, event);

      switch (event.type) {
        case "content_delta":
          contentParts.push(event.content);
          break;
        case "reasoning_delta":
          reasoningParts.push(event.reasoning);
          tripReasoningBudget();
          break;
        case "tool_call_delta":
          toolDeltas.push(...event.toolCalls);
          break;
        case "usage":
          usage = {
            inputTokens: event.usage.inputTokens,
            outputTokens: event.usage.outputTokens,
            cacheHitTokens: event.usage.cacheHitTokens,
            cacheMissTokens: event.usage.cacheMissTokens,
          };
          break;
        case "completed":
          finishReason = event.finishReason;
          if (event.usage) {
            usage = {
              inputTokens: event.usage.inputTokens,
              outputTokens: event.usage.outputTokens,
              cacheHitTokens: event.usage.cacheHitTokens,
              cacheMissTokens: event.usage.cacheMissTokens,
            };
          }
          break;
        case "cancelled":
          if (reasoningBudgetExceeded) {
            break;
          }
          return { kind: "cancelled" };
        case "failed":
          if (reasoningBudgetExceeded) {
            break;
          }
          return {
            kind: "failed",
            content: contentParts.join("") || reasoningParts.join(""),
            errorCode: event.error.code,
            errorMessage: event.error.message,
          };
        default:
          break;
      }
    }
  } catch (error) {
    if (signal.aborted) {
      return { kind: "cancelled" };
    }
    if (!reasoningBudgetExceeded) {
      return {
        kind: "failed",
        content: contentParts.join("") || reasoningParts.join(""),
        errorCode: "provider_failed",
        errorMessage:
          error instanceof Error ? error.message : "Model invocation failed.",
      };
    }
  }

  if (signal.aborted && !reasoningBudgetExceeded) {
    return { kind: "cancelled" };
  }

  if (reasoningBudgetExceeded) {
    finishReason = "length";
    runtime.emit(bus, {
      type: "warning",
      runId,
      message: `Reasoning channel exceeded ${maxReasoningChars} characters without content or tools; treating turn as output-truncated.`,
      code: "reasoning_progress_budget_exceeded",
      at: runtime.isoNow(),
    });
  }

  // Prefer the content channel. Only promote reasoning when it can stand as a
  // user-facing answer — never for length-truncated reasoning burns (BillBuddy
  // 23:45 emptied the UI after a 5k reasoning dump poisoned pending text).
  const visibleContent = contentParts.join("");
  const reasoning = reasoningParts.join("");
  const content =
    visibleContent ||
    (reasoning &&
    finishReason !== "length" &&
    !isMidWorkAnalysisDump(reasoning) &&
    !isUnfinishedInvestigationAnswer(reasoning)
      ? reasoning
      : "");

  return {
    kind: "completed",
    content,
    toolCalls: assembleToolCalls(toolDeltas),
    usage,
    finishReason,
    reasoningBudgetExceeded: reasoningBudgetExceeded || undefined,
  };
}

export function forwardModelEvent(
  runtime: AgentEngineRuntime,
  bus: EventBus,
  runId: string,
  event: ModelEvent,
): void {
  if (event.type === "content_delta") {
    runtime.emit(bus, {
      type: "model_delta",
      runId,
      kind: "content",
      preview: event.content.slice(0, 200),
      at: runtime.isoNow(),
    });
    return;
  }
  if (event.type === "reasoning_delta") {
    runtime.emit(bus, {
      type: "model_delta",
      runId,
      kind: "reasoning",
      preview: event.reasoning.slice(0, 200),
      at: runtime.isoNow(),
    });
    return;
  }
  if (event.type === "tool_call_delta") {
    const name = event.toolCalls.find((c) => c.name)?.name;
    runtime.emit(bus, {
      type: "model_delta",
      runId,
      kind: "tool_call",
      preview: name,
      at: runtime.isoNow(),
    });
  }
}
