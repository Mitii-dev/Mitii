import { describe, expect, it } from "vitest";

import { StoreManager } from "../../helpers/store";
import { InMemoryGateCheckpointStore } from "../../helpers/gates";
import {
  buildHeartbeatCheckpoint,
  HEARTBEAT_CHECKPOINT_KIND,
  maybeSaveHeartbeatCheckpoint,
  selectHeartbeatPolicy,
  shouldSaveHeartbeatCheckpoint,
} from "../../helpers/heartbeat";
import { hydrateRunStateFromCheckpoint, RunState } from "../../helpers/run-state";

describe("S11-HEART heartbeat checkpoints", () => {
  it("selectHeartbeatPolicy enables agent execute by default", () => {
    const on = selectHeartbeatPolicy({ mode: "agent", route: "execute" });
    expect(on.enabled).toBe(true);
    expect(on.onMutationBatch).toBe(true);
    expect(on.everyTurns).toBe(3);

    const ask = selectHeartbeatPolicy({ mode: "ask", route: "answer" });
    expect(ask.enabled).toBe(false);

    const killed = selectHeartbeatPolicy({
      mode: "agent",
      route: "execute",
      heartbeat: false,
    });
    expect(killed.enabled).toBe(false);
  });

  it("shouldSaveHeartbeatCheckpoint fires on mutation or every N turns", () => {
    const policy = selectHeartbeatPolicy({ mode: "agent", route: "execute" });
    expect(
      shouldSaveHeartbeatCheckpoint({
        policy,
        turnCount: 1,
        turnsSinceLastHeartbeat: 1,
        mutationBatchSucceeded: true,
      }).save,
    ).toBe(true);

    expect(
      shouldSaveHeartbeatCheckpoint({
        policy,
        turnCount: 3,
        turnsSinceLastHeartbeat: 3,
        mutationBatchSucceeded: false,
      }).save,
    ).toBe(true);

    expect(
      shouldSaveHeartbeatCheckpoint({
        policy,
        turnCount: 1,
        turnsSinceLastHeartbeat: 1,
        mutationBatchSucceeded: false,
      }).save,
    ).toBe(false);
  });

  it("maybeSaveHeartbeatCheckpoint persists and hydrates", async () => {
    const store = StoreManager.create("hb-1");
    store.setSlice("lastAssistantText", "mid-run");
    const cps = new InMemoryGateCheckpointStore();

    const result = await maybeSaveHeartbeatCheckpoint({
      deps: { checkpointStore: cps },
      store,
      runId: "hb-1",
      mode: "agent",
      route: "execute",
      turnCount: 3,
      turnsSinceLastHeartbeat: 3,
    });
    expect(result.saved).toBe(true);
    expect(result.reasonCodes).toContain("heartbeat_saved");

    const saved = await cps.load?.("hb-1");
    expect(saved?.suspensionKind).toBe(HEARTBEAT_CHECKPOINT_KIND);
    expect(saved?.payload.heartbeat).toBe(true);

    const store2 = StoreManager.create("hb-1");
    const rs = RunState.from(store2);
    const hydrated = hydrateRunStateFromCheckpoint(rs, saved!);
    expect(hydrated.hydrated).toBe(true);
    expect(rs.get("lastAssistantText")).toBe("mid-run");
  });

  it("buildHeartbeatCheckpoint is non-user-facing", () => {
    const store = StoreManager.create("hb-2");
    const cp = buildHeartbeatCheckpoint({
      runId: "hb-2",
      requestId: "hb-2",
      store,
    });
    expect(cp.suspensionKind).toBe("heartbeat");
    expect(cp.payload.heartbeat).toBe(true);
  });
});
