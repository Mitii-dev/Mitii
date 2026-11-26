import { describe, expect, it } from "vitest";

import { composeRuntime } from "../../adapters/compose/ComposeRuntime";
import { InMemoryGateCheckpointStore } from "../../helpers/gates/InMemoryGateCheckpointStore";
import { InMemoryRuntimeSessionStore } from "../../helpers/checkpoint/InMemoryRuntimeSessionStore";
import { StoreManager } from "../../helpers/store";
import { readStoreSnapshotFromCheckpoint } from "../../helpers/checkpoint/ReadStoreSnapshotFromCheckpoint";

describe("StoreManager snapshot/hydrate", () => {
  it("round-trips slices through snapshot", () => {
    const mgr = StoreManager.create("snap-1", () => "t0");
    mgr.setSlice("decision", { route: "answer" });
    mgr.setSlice("toolJournal", [{ id: "a" }]);

    const snap = mgr.snapshot();
    expect(snap.runId).toBe("snap-1");
    expect(snap.slices.decision).toEqual({ route: "answer" });

    const other = StoreManager.create("snap-1", () => "t1");
    other.hydrate(snap);
    expect(other.getSlice("decision")).toEqual({ route: "answer" });
    expect(other.getSlice("toolJournal")).toEqual([{ id: "a" }]);
  });

  it("rejects hydrate across runIds", () => {
    const mgr = StoreManager.create("a");
    const snap = StoreManager.create("b").snapshot();
    expect(() => mgr.hydrate(snap)).toThrow(/store_hydrate_run_id_mismatch/);
  });

  it("embeds storeSnapshot in gate checkpoint and resume hydrates", async () => {
    const checkpointStore = new InMemoryGateCheckpointStore();
    const sessionStore = new InMemoryRuntimeSessionStore();
    const runtime = composeRuntime({ checkpointStore, sessionStore });

    await runtime.start({
      start: { message: "fix it", runId: "hydrate-1" },
      mode: "ask",
      runId: "hydrate-1",
    });

    const ckpt = await checkpointStore.load("hydrate-1");
    const snap = readStoreSnapshotFromCheckpoint(ckpt);
    expect(snap?.runId).toBe("hydrate-1");
    expect(snap?.slices.decision).toBeDefined();

    const resumed = await runtime.resume({
      runId: "hydrate-1",
      decision: "clarify_answer",
      clarifyAnswer: "what is 2+2 in general?",
    });
    expect(resumed.reasonCodes).toContain("runtime_store_hydrated");
    expect(resumed.storeHydrated).toBe(true);
  });
});
