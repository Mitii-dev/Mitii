import { describe, expect, it } from "vitest";

import { finalizeCampaignSliceOnFinish } from "../../helpers/task/FinalizeCampaignSliceOnFinish";
import { StoreManager } from "../../helpers/store";
import { TASK_LIST_SCHEMA_VERSION } from "../../../modules/task-list";

describe("finalizeCampaignSliceOnFinish", () => {
  it("advances unbound active row once when edits landed", () => {
    const store = StoreManager.create("fin-1");
    store.setSlice("taskList", {
      schemaVersion: TASK_LIST_SCHEMA_VERSION,
      source: "agent",
      purpose: "execution",
      items: [
        { id: "slice_1", title: "Research and lock the first slice", status: "active" },
        { id: "slice_2", title: "Implement the first safe slice", status: "pending" },
      ],
    });
    store.setSlice("changedFiles", ["packages/checks/src/builtins/http.js"]);

    const result = finalizeCampaignSliceOnFinish({
      store,
      editsLanded: true,
    });
    expect(result.advanced).toBe(true);
    expect(result.advancedIds).toEqual(["slice_1"]);
    expect(store.getSlice<string[]>("campaignAdvancedThisTurn")).toEqual([
      "slice_1",
    ]);
    const list = store.getSlice<{
      items: Array<{ id: string; status: string }>;
    }>("taskList");
    expect(list?.items[0]?.status).toBe("done");
    expect(list?.items[1]?.status).toBe("active");
  });

  it("does not advance discovery lists", () => {
    const store = StoreManager.create("fin-2");
    store.setSlice("taskList", {
      schemaVersion: TASK_LIST_SCHEMA_VERSION,
      source: "discovery",
      purpose: "discovery",
      items: [
        { id: "a", title: "Find entry", status: "active" },
      ],
    });
    store.setSlice("changedFiles", ["a.ts"]);
    const result = finalizeCampaignSliceOnFinish({
      store,
      editsLanded: true,
    });
    expect(result.advanced).toBe(false);
  });
});
