import { describe, expect, it, vi } from "vitest";

import type { LlmPort, ModelEvent, ModelRequest } from "../../../../modules/model-gateway";
import { EventBus } from "../../internal/EventBus";
import type { AgentEngineRuntime } from "../runtime";
import { consumeModelTurn } from "../consumeModelTurn";

async function* reasoningFlood(
  _request: ModelRequest,
): AsyncIterable<ModelEvent> {
  for (let i = 0; i < 40; i += 1) {
    yield {
      type: "reasoning_delta",
      reasoning: "x".repeat(400),
    };
  }
  yield { type: "completed", finishReason: "stop" };
}

describe("consumeModelTurn reasoning progress budget", () => {
  it("treats unbounded reasoning-only streams as length truncation", async () => {
    const warnings: Array<{ code?: string; message: string }> = [];
    const runtime = {
      emit: (_bus: EventBus, event: { type: string; code?: string; message?: string }) => {
        if (event.type === "warning") {
          warnings.push({
            code: event.code,
            message: event.message ?? "",
          });
        }
      },
      isoNow: () => "2026-09-20T00:00:00.000Z",
    } as unknown as AgentEngineRuntime;
    const bus = new EventBus();

    const llm = {
      id: "stub",
      capabilities: {
        modelId: "stub",
        contextWindowTokens: 32_000,
        maximumOutputTokens: 4_000,
        supportsTools: true,
        supportsStreaming: true,
        supportsVision: false,
        supportsReasoning: true,
      },
      complete: reasoningFlood,
    } as unknown as LlmPort;

    const turn = await consumeModelTurn(runtime, {
      llm,
      request: { messages: [{ role: "user", content: "fix it" }] },
      runId: "run_reasoning_budget",
      signal: new AbortController().signal,
      bus,
      maxReasoningCharsWithoutProgress: 1_000,
    });

    expect(turn.kind).toBe("completed");
    if (turn.kind !== "completed") {
      return;
    }
    expect(turn.finishReason).toBe("length");
    expect(turn.reasoningBudgetExceeded).toBe(true);
    expect(turn.content).toBe("");
    expect(turn.toolCalls).toHaveLength(0);
    expect(
      warnings.some((w) => w.code === "reasoning_progress_budget_exceeded"),
    ).toBe(true);
  });

  it("does not trip when tools arrive before the budget", async () => {
    async function* mixedStream(): AsyncIterable<ModelEvent> {
      yield { type: "reasoning_delta", reasoning: "plan briefly" };
      yield {
        type: "tool_call_delta",
        toolCalls: [
          {
            index: 0,
            id: "c1",
            name: "read_file",
            arguments: '{"path":"a.ts"}',
          },
        ],
      };
      yield { type: "completed", finishReason: "tool_calls" };
    }

    const runtime = {
      emit: vi.fn(),
      isoNow: () => "2026-09-20T00:00:00.000Z",
    } as unknown as AgentEngineRuntime;

    const turn = await consumeModelTurn(runtime, {
      llm: {
        id: "stub",
        capabilities: {},
        complete: mixedStream,
      } as unknown as LlmPort,
      request: { messages: [{ role: "user", content: "read" }] },
      runId: "run_ok",
      signal: new AbortController().signal,
      bus: new EventBus(),
      maxReasoningCharsWithoutProgress: 500,
    });

    expect(turn.kind).toBe("completed");
    if (turn.kind !== "completed") {
      return;
    }
    expect(turn.reasoningBudgetExceeded).toBeUndefined();
    expect(turn.finishReason).toBe("tool_calls");
    expect(turn.toolCalls).toHaveLength(1);
  });
});
