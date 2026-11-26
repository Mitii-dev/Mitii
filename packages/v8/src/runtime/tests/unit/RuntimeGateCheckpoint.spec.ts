import { describe, expect, it } from "vitest";

import { composeRuntime } from "../../adapters/compose/ComposeRuntime";
import { InMemoryGateCheckpointStore } from "../../helpers/gates/InMemoryGateCheckpointStore";
import { InMemoryRuntimeSessionStore } from "../../helpers/checkpoint/InMemoryRuntimeSessionStore";

describe("runtime gate checkpoint", () => {
  it("saves checkpoint on clarify suspend and resume hydrates it", async () => {
    const checkpointStore = new InMemoryGateCheckpointStore();
    const sessionStore = new InMemoryRuntimeSessionStore();
    const runtime = composeRuntime({ checkpointStore, sessionStore });

    const started = await runtime.start({
      start: { message: "fix it", runId: "ckpt-1" },
      mode: "ask",
      runId: "ckpt-1",
    });
    expect(started.status).toBe("suspended");
    expect(started.checkpointSaved).toBe(true);
    expect(started.gateKind).toBe("clarification_required");

    const loaded = await runtime.loadCheckpoint("ckpt-1");
    expect(loaded?.suspensionKind).toBe("clarification_required");
    expect(loaded?.runId).toBe("ckpt-1");

    const resumed = await runtime.resume({
      runId: "ckpt-1",
      decision: "clarify_answer",
      clarifyAnswer: "what is 2+2 in general?",
    });
    expect(resumed.reasonCodes).toContain(
      "runtime_resume_from_gate_checkpoint",
    );
  });

  it("composeRuntime installs an in-memory checkpoint store by default", async () => {
    const runtime = composeRuntime();
    await runtime.start({
      start: { message: "fix it", runId: "ckpt-2" },
      mode: "ask",
      runId: "ckpt-2",
    });
    const loaded = await runtime.loadCheckpoint("ckpt-2");
    expect(loaded?.suspensionKind).toBe("clarification_required");
  });
});
