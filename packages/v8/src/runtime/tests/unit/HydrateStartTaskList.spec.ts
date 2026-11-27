import { describe, expect, it } from "vitest";

import {
  hasOpenExecutionChecklist,
  hydrateStartTaskList,
} from "../../helpers/task";
import { StoreManager } from "../../helpers/store";

describe("hydrateStartTaskList", () => {
  it("loads host execution checklist into an empty store", () => {
    const store = StoreManager.create("hydrate-1");
    const result = hydrateStartTaskList({
      store,
      start: {
        message: "next",
        taskList: {
          schemaVersion: 1,
          source: "agent",
          purpose: "execution",
          items: [
            { id: "slice_1", title: "HTTP desugar", status: "done" },
            { id: "slice_2", title: "React cases", status: "pending" },
          ],
        },
        completedPlanStepIds: ["slice_1"],
      },
    });
    expect(result.hydrated).toBe(true);
    expect(hasOpenExecutionChecklist(store.getSlice("taskList"))).toBe(true);
    expect(store.getSlice<string[]>("completedPlanStepIds")).toEqual([
      "slice_1",
    ]);
  });

  it("ignores discovery-only host lists for open-checklist signal", () => {
    expect(
      hasOpenExecutionChecklist({
        schemaVersion: 1,
        source: "discovery",
        purpose: "discovery",
        items: [{ id: "a", title: "Find entry", status: "pending" }],
      }),
    ).toBe(false);
  });
});
