import { describe, expect, it } from "vitest";

import { composeRuntime } from "../../adapters/compose/ComposeRuntime";
import { adaptAgentStartMessage } from "../../helpers/adapt/AdaptAgentStartMessage";

describe("RuntimePipeline.start / resume", () => {
  it("suspends clarify via start facade", async () => {
    const runtime = composeRuntime();
    const result = await runtime.start({
      start: { message: "fix it" },
      mode: "agent",
      runId: "rs-1",
    });
    expect(result.status).toBe("suspended");
    expect(result.route).toBe("clarify");
    expect(result.reasonCodes).toContain("runtime_start_suspended");
  });

  it("completes ask research shell without verify", async () => {
    const runtime = composeRuntime();
    const result = await runtime.start({
      start: {
        message: "how does packages/v8/src/runtime StoreManager work?",
      },
      mode: "ask",
      runId: "rs-2",
    });
    expect(result.status).toBe("completed");
    expect(result.grantProfile).not.toBe("agent_execute");
    expect(result.reasonCodes).toContain("runtime_start_completed");
  });

  it("adapts agent-start-shaped input", async () => {
    const adapted = adaptAgentStartMessage({
      request: { userMessage: "plan the refactor", mode: "plan" },
    });
    expect(adapted).toMatchObject({
      message: "plan the refactor",
      mode: "plan",
    });
    const runtime = composeRuntime();
    const result = await runtime.start({
      request: { userMessage: "plan packages/v8/src/runtime helpers", mode: "plan" },
      runId: "rs-3",
    });
    expect(result.status).toBe("completed");
    expect(result.route).toBe("plan");
  });

  it("resume clarify_answer re-drives decide", async () => {
    const runtime = composeRuntime();
    const result = await runtime.resume({
      runId: "rs-4",
      decision: "clarify_answer",
      clarifyAnswer:
        "refactor packages/v8/src/runtime helpers for clarity",
      message: "fix it",
      mode: "agent",
    });
    expect(result.resumeReenter).toBe("decide");
    expect(result.reasonCodes).toContain("runtime_resume_completed");
  });

  it("resume reject terminates", async () => {
    const runtime = composeRuntime();
    const result = await runtime.resume({
      runId: "rs-5",
      decision: "reject",
      message: "anything",
    });
    expect(result.status).toBe("cancelled");
    expect(result.reasonCodes).toContain("runtime_resume_terminal");
  });
});
