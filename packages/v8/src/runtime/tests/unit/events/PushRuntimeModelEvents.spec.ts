import { describe, expect, it } from "vitest";

import {
  AGENT_ENGINE_SCHEMA_VERSION,
  type RunEvent,
} from "../../../../engine/v8-engine/contracts";
import {
  mergeRuntimeModelUsage,
  pushRuntimeModelStreamEvent,
  pushRuntimeModelTurnEvent,
} from "../../../helpers/events/PushRuntimeModelEvents";
import { buildRuntimeBridgeEvents } from "../../../adapters/bridge/BuildRuntimeBridgeEvents";

describe("PushRuntimeModelEvents", () => {
  it("emits reasoning and content model_delta previews", () => {
    const events: RunEvent[] = [];
    const sink = { push: (e: RunEvent) => events.push(e) };

    pushRuntimeModelStreamEvent(sink, {
      runId: "run_1",
      event: { type: "reasoning_delta", reasoning: "thinking hard" },
      at: "2026-01-01T00:00:00.000Z",
    });
    pushRuntimeModelStreamEvent(sink, {
      runId: "run_1",
      event: { type: "content_delta", content: "answer chunk" },
      at: "2026-01-01T00:00:01.000Z",
    });
    pushRuntimeModelTurnEvent(sink, {
      runId: "run_1",
      turnIndex: 0,
      usage: { inputTokens: 100, outputTokens: 40 },
      finishReason: "stop",
      at: "2026-01-01T00:00:02.000Z",
    });

    expect(events).toEqual([
      {
        type: "model_delta",
        runId: "run_1",
        kind: "reasoning",
        preview: "thinking hard",
        at: "2026-01-01T00:00:00.000Z",
      },
      {
        type: "model_delta",
        runId: "run_1",
        kind: "content",
        preview: "answer chunk",
        at: "2026-01-01T00:00:01.000Z",
      },
      {
        type: "model_turn",
        runId: "run_1",
        turnIndex: 0,
        finishReason: "stop",
        inputTokens: 100,
        outputTokens: 40,
        at: "2026-01-01T00:00:02.000Z",
      },
    ]);
  });

  it("aggregates usage across turns", () => {
    expect(
      mergeRuntimeModelUsage(
        { inputTokens: 10, outputTokens: 3 },
        { inputTokens: 20, outputTokens: 5, cacheHitTokens: 4 },
      ),
    ).toEqual({
      inputTokens: 30,
      outputTokens: 8,
      cacheHitTokens: 4,
      cacheMissTokens: undefined,
    });
  });
});

describe("buildRuntimeBridgeEvents live skip", () => {
  it("skips synthetic model paste when live content deltas already ran", () => {
    const events = buildRuntimeBridgeEvents({
      runtime: {
        schemaVersion: 1,
        runId: "run_live",
        status: "completed",
        answer: "final answer that should not be re-pasted as a late delta",
        reasonCodes: [
          "runtime_live_model_events",
          "runtime_live_content_deltas",
          "runtime_live_tool_events",
        ],
        usage: {
          modelCalls: 2,
          toolCalls: 1,
          loopIterations: 2,
          inputTokens: 50,
          outputTokens: 20,
        },
        toolInvocations: [
          {
            invocationId: "t1",
            toolId: "read_file",
            status: "succeeded",
          },
        ],
      },
      result: {
        schemaVersion: AGENT_ENGINE_SCHEMA_VERSION,
        runId: "run_live",
        requestId: "run_live",
        status: "completed",
        route: "repository_answer",
        reasonCodes: ["answer_produced"],
        warnings: [],
        usage: { modelCalls: 2, toolCalls: 1, loopIterations: 2 },
        durationMs: 0,
      },
      at: "2026-01-01T00:00:00.000Z",
    });

    expect(events.some((e) => e.type === "model_delta")).toBe(false);
    expect(events.some((e) => e.type === "model_turn")).toBe(false);
    expect(events.some((e) => e.type === "tool_started")).toBe(false);
    expect(events.some((e) => e.type === "terminal")).toBe(true);
  });

  it("pastes content when only model_turn was live (buffered provider)", () => {
    const events = buildRuntimeBridgeEvents({
      runtime: {
        schemaVersion: 1,
        runId: "run_buffered",
        status: "completed",
        answer: "Buffered answer that must still reach Desktop",
        reasonCodes: ["runtime_live_model_events", "runtime_live_tool_events"],
        usage: {
          modelCalls: 1,
          toolCalls: 0,
          loopIterations: 1,
        },
        toolInvocations: [],
      },
      result: {
        schemaVersion: AGENT_ENGINE_SCHEMA_VERSION,
        runId: "run_buffered",
        requestId: "run_buffered",
        status: "completed",
        route: "repository_answer",
        reasonCodes: ["answer_produced"],
        warnings: [],
        usage: { modelCalls: 1, toolCalls: 0, loopIterations: 1 },
        durationMs: 0,
      },
      at: "2026-01-01T00:00:00.000Z",
    });

    expect(
      events.some(
        (e) =>
          e.type === "model_delta" &&
          e.kind === "content" &&
          typeof e.preview === "string" &&
          e.preview.includes("Buffered answer"),
      ),
    ).toBe(true);
    expect(events.some((e) => e.type === "model_turn")).toBe(false);
  });
});
