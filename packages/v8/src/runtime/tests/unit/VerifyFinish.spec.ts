import { describe, expect, it } from "vitest";

import { StoreManager } from "../../helpers/store";
import { verifyFinish } from "../../flow/steps/11-VerifyFinish";
import { selectRouteBody } from "../../helpers/routes";

describe("verifyFinish", () => {
  it("skips verify for answer route", () => {
    const store = StoreManager.create("v1");
    store.setSlice("decision", {
      route: "answer",
      routeBody: selectRouteBody({ route: "answer" }),
    });
    const result = verifyFinish({
      store,
      input: { message: "what is X?" },
      mode: "ask",
    });
    expect(result.ranVerify).toBe(false);
    expect(result.finished).toBe(true);
  });

  it("runs verify for execute and invalidates when journal grows", () => {
    const store = StoreManager.create("v2");
    store.setSlice("decision", {
      route: "execute",
      routeBody: selectRouteBody({
        route: "execute",
        planningDepth: "none",
      }),
    });
    store.setSlice("toolJournal", [{ id: 1 }]);
    const first = verifyFinish({
      store,
      input: { message: "fix a.ts" },
      mode: "agent",
    });
    expect(first.ranVerify).toBe(true);
    expect(first.invalidated).toBe(false);

    store.setSlice("toolJournal", [{ id: 1 }, { id: 2 }]);
    const second = verifyFinish({
      store,
      input: { message: "fix a.ts" },
      mode: "agent",
    });
    expect(second.invalidated).toBe(true);
    expect(second.reasonCodes).toContain("verify_invalidated_after_mutate");
  });
});
