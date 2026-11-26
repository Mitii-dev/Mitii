import { describe, expect, it } from "vitest";

import { composeRuntime } from "../../adapters/compose/ComposeRuntime";
import { InMemoryRuntimeSessionStore } from "../../helpers/checkpoint/InMemoryRuntimeSessionStore";

describe("runtime session carry", () => {
  it("saves carry on start and resume can omit message", async () => {
    const store = new InMemoryRuntimeSessionStore();
    const runtime = composeRuntime({ sessionStore: store });

    const started = await runtime.start({
      start: { message: "fix it", runId: "carry-1" },
      mode: "ask",
      runId: "carry-1",
    });
    expect(started.status).toBe("suspended");
    expect(store.load("carry-1")?.message).toBe("fix it");
    expect(store.load("carry-1")?.mode).toBe("ask");

    const resumed = await runtime.resume({
      runId: "carry-1",
      decision: "clarify_answer",
      clarifyAnswer: "what is 2+2 in general?",
    });
    expect(resumed.reasonCodes).toContain("runtime_resume_from_session_carry");
    expect(resumed.reasonCodes).toContain("runtime_resume_completed");
    expect(["completed", "suspended"]).toContain(resumed.status);
  });

  it("composeRuntime installs an in-memory session store by default", async () => {
    const runtime = composeRuntime();
    await runtime.start({
      start: { message: "fix it", runId: "carry-2" },
      mode: "ask",
      runId: "carry-2",
    });
    const carry = await runtime.loadSession("carry-2");
    expect(carry?.message).toBe("fix it");
  });
});
