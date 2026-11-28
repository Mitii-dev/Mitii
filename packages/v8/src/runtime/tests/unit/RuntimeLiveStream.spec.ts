import { describe, expect, it } from "vitest";

import { EchoLlmPort } from "../../../modules/model-gateway";
import { composeAgentEngine } from "../../../engine/v8-engine/adapters/composeAgentEngine";
import { composeRuntime } from "../../adapters/compose/ComposeRuntime";
import { createLiveAgentRunHandleFromRuntimeStart } from "../../adapters/bridge/CreateLiveAgentRunHandle";
import { runEventSchema } from "../../../engine/v8-engine/contracts";

describe("runtime live event streaming", () => {
  it("yields received stage before the run result resolves", async () => {
    const runtime = composeRuntime({
      model: undefined,
    });
    const handle = createLiveAgentRunHandleFromRuntimeStart({
      runtime,
      start: { message: "fix it", runId: "live-1" },
      mode: "ask",
      runId: "live-1",
    });

    const first = await handle.events.next();
    expect(first.done).toBe(false);
    expect(first.value?.type).toBe("stage_started");
    expect(first.value).toMatchObject({ stage: "received" });
    expect(() => runEventSchema.parse(first.value)).not.toThrow();

    const result = await handle.result;
    expect(result.status).toBe("suspended");

    // Drain remaining events
    for await (const event of handle.events) {
      expect(() => runEventSchema.parse(event)).not.toThrow();
    }
  });

  it("composed engine.start streams live events", async () => {
    const llm = new EchoLlmPort();
    const { engine } = composeAgentEngine({
      understandingLlm: llm,
      runLlm: llm,
      enablePlanning: false,
    });
    const handle = engine.start({
      schemaVersion: 1,
      request: {
        sessionId: "live-2",
        mode: "ask",
        userMessage: "fix it",
        workspace: { workspaceId: "ws" },
      },
    });
    const types: string[] = [];
    for await (const event of handle.events) {
      types.push(event.type);
      expect(() => runEventSchema.parse(event)).not.toThrow();
    }
    expect(types[0]).toBe("stage_started");
    expect(types).toContain("terminal");
    const result = await handle.result;
    expect(result.status).toBe("suspended");
  });
});
