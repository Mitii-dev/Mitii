import { describe, expect, it } from "vitest";

import { StoreManager } from "../../helpers/store";

describe("StoreManager", () => {
  it("creates an empty store and sets slices immutably", () => {
    const mgr = StoreManager.create("run-1", () => "2026-01-01T00:00:00.000Z");
    expect(mgr.getStore().runId).toBe("run-1");
    expect(mgr.getSlice("decision")).toBeUndefined();

    mgr.setSlice("decision", { route: "answer" });
    expect(mgr.getSlice("decision")).toEqual({ route: "answer" });
    expect(mgr.getStore().updatedAt).toBe("2026-01-01T00:00:00.000Z");
  });

  it("marks cancelling without wiping slices", () => {
    const mgr = StoreManager.create("run-2", () => "t0");
    mgr.setSlice("plan", { id: "p1" });
    mgr.requestCancel();
    expect(mgr.isCancelling()).toBe(true);
    expect(mgr.getSlice("plan")).toEqual({ id: "p1" });
  });
});
