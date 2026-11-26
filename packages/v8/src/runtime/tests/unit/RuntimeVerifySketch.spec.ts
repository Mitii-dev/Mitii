import { describe, expect, it } from "vitest";

import { EchoLlmPort } from "../../../modules/model-gateway";
import { completeViaLlmPort } from "../../adapters/model/CompleteViaLlmPort";
import { composeRuntime } from "../../adapters/compose/ComposeRuntime";
import { createAgentRunHandleFromRuntimeResult } from "../../adapters/bridge/AgentRunHandleFromRuntimeResult";
import { runEventSchema } from "../../../engine/v8-engine/contracts";

describe("runtime verify sketch", () => {
  it("attaches verify sketch on completed ask path", async () => {
    const runtime = composeRuntime({
      model: completeViaLlmPort(new EchoLlmPort()),
    });
    const shell = await runtime.start({
      start: { message: "what is 2+2 in general?", runId: "vf-1" },
      mode: "ask",
      runId: "vf-1",
    });
    expect(shell.status).toBe("completed");
    expect(shell.verify).toBeDefined();
    expect(shell.verify?.finished).toBe(true);
    expect(typeof shell.verify?.ranVerify).toBe("boolean");
  });

  it("emits verifying stage + verification_completed when ranVerify", async () => {
    const handle = createAgentRunHandleFromRuntimeResult({
      schemaVersion: 1,
      runId: "vf-2",
      status: "completed",
      route: "agent_execute",
      answer: "patched",
      verify: { ranVerify: true, invalidated: false, finished: true },
      reasonCodes: ["verify_shell", "runtime_start_completed"],
    });
    const types: string[] = [];
    for await (const event of handle.events) {
      types.push(event.type);
      expect(() => runEventSchema.parse(event)).not.toThrow();
    }
    expect(types).toContain("verification_completed");
    expect(
      types.filter((t) => t === "stage_started").length,
    ).toBeGreaterThanOrEqual(2);
  });

  it("emits warning when verify was invalidated", async () => {
    const handle = createAgentRunHandleFromRuntimeResult({
      schemaVersion: 1,
      runId: "vf-3",
      status: "completed",
      route: "agent_execute",
      verify: { ranVerify: true, invalidated: true, finished: true },
      reasonCodes: ["verify_invalidated_after_mutate"],
    });
    const events = [];
    for await (const event of handle.events) {
      events.push(event);
      expect(() => runEventSchema.parse(event)).not.toThrow();
    }
    const warning = events.find((e) => e.type === "warning");
    expect(warning).toMatchObject({
      type: "warning",
      code: "verify_invalidated_after_mutate",
    });
    const completed = events.find((e) => e.type === "verification_completed");
    expect(completed).toMatchObject({
      type: "verification_completed",
      status: "implemented_unverified",
    });
  });
});
