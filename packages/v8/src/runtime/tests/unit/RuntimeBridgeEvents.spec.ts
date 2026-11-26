import { describe, expect, it } from "vitest";

import { EchoLlmPort } from "../../../modules/model-gateway";
import { completeViaLlmPort } from "../../adapters/model/CompleteViaLlmPort";
import { composeRuntime } from "../../adapters/compose/ComposeRuntime";
import { createAgentRunHandleFromRuntimeResult } from "../../adapters/bridge/AgentRunHandleFromRuntimeResult";
import { runEventSchema } from "../../../engine/v8-engine/contracts";

describe("runtime bridge events", () => {
  it("emits stage + model events for completed ask with Echo", async () => {
    const runtime = composeRuntime({
      model: completeViaLlmPort(new EchoLlmPort()),
    });
    const shell = await runtime.start({
      start: { message: "what is 2+2 in general?", runId: "ev-1" },
      mode: "ask",
      runId: "ev-1",
    });
    expect(shell.status).toBe("completed");
    expect(shell.answer).toContain("Echo:");
    expect(shell.usage?.modelCalls).toBeGreaterThan(0);

    const handle = createAgentRunHandleFromRuntimeResult(shell);
    const events = [];
    for await (const event of handle.events) {
      events.push(event);
      expect(() => runEventSchema.parse(event)).not.toThrow();
    }

    expect(events.some((e) => e.type === "stage_started")).toBe(true);
    expect(events.some((e) => e.type === "decision_made")).toBe(true);
    expect(events.some((e) => e.type === "model_delta")).toBe(true);
    expect(events.some((e) => e.type === "model_turn")).toBe(true);
    expect(events.some((e) => e.type === "terminal")).toBe(true);
  });

  it("emits tool events when journaled invocations exist", async () => {
    const handle = createAgentRunHandleFromRuntimeResult({
      schemaVersion: 1,
      runId: "ev-2",
      status: "completed",
      route: "repository_answer",
      answer: "done",
      usage: { modelCalls: 1, toolCalls: 1, loopIterations: 1 },
      toolInvocations: [
        {
          invocationId: "inv_1",
          toolId: "read_file",
          status: "succeeded",
        },
      ],
      reasonCodes: ["runtime_start_completed"],
    });
    const types: string[] = [];
    for await (const event of handle.events) {
      types.push(event.type);
      expect(() => runEventSchema.parse(event)).not.toThrow();
    }
    expect(types).toContain("tool_started");
    expect(types).toContain("tool_completed");
    expect(types).toContain("model_delta");
  });
});
