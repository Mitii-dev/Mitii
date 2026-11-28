import { describe, expect, it } from "vitest";

import { InMemoryRuntimeSessionStore } from "../../helpers/checkpoint/InMemoryRuntimeSessionStore";
import {
  dialogueContinuityStoreKey,
  loadDialogueContinuity,
  mergeHistoryContinuity,
  saveDialogueContinuity,
} from "../../helpers/continuity";

describe("dialogue continuity session store", () => {
  it("saves and loads continuity by sessionId", async () => {
    const store = new InMemoryRuntimeSessionStore();
    const deps = { sessionStore: store };

    await saveDialogueContinuity(deps, {
      sessionId: "thread_abc",
      message: "brainstorm checks",
      mode: "agent",
      priorRoute: "answer",
      priorTaskBand: "medium",
      endingPosture: "proposal_ready",
    });

    expect(store.load(dialogueContinuityStoreKey("thread_abc"))?.endingPosture).toBe(
      "proposal_ready",
    );

    const loaded = await loadDialogueContinuity(deps, "thread_abc");
    const merged = mergeHistoryContinuity(
      { digest: "user: continue" },
      loaded,
    );
    expect(merged?.priorRoute).toBe("answer");
    expect(merged?.endingPosture).toBe("proposal_ready");
  });
});
