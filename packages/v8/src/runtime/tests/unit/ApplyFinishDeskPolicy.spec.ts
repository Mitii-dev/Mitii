import { describe, expect, it } from "vitest";

import { applyFinishDeskPolicy } from "../../helpers/task/ApplyFinishDeskPolicy";
import {
  sealVerifyRepairDesk,
  VERIFY_REPAIR_DESK_TITLE,
} from "../../helpers/task/SealVerifyRepairDesk";
import { TASK_LIST_SCHEMA_VERSION } from "../../../modules/task-list";

function memoryStore(seed: Record<string, unknown> = {}) {
  const data = new Map<string, unknown>(Object.entries(seed));
  return {
    getSlice: <T>(key: string) => data.get(key) as T | undefined,
    setSlice: (key: string, value: unknown) => {
      if (value === undefined) data.delete(key);
      else data.set(key, value);
    },
    raw: data,
  };
}

describe("applyFinishDeskPolicy", () => {
  const campaign = {
    schemaVersion: TASK_LIST_SCHEMA_VERSION,
    source: "plan" as const,
    purpose: "execution" as const,
    title: "Campaign",
    items: [
      { id: "s1", title: "HTTP desugar", status: "done" as const },
      { id: "s2", title: "Session continuity", status: "pending" as const },
    ],
  };

  it("restores prior campaign on could_not_run soft-pass while on repair desk", () => {
    const repair = sealVerifyRepairDesk({
      failureNote: "Could not run `node --test a.js`",
      failedCommand: "node --test a.js",
    });
    const store = memoryStore({
      taskList: repair,
      priorExecutionTaskList: campaign,
    });

    const result = applyFinishDeskPolicy({
      store,
      mode: "agent",
      sealRepair: false,
      verifyPassed: false,
      finishStatus: "completed",
      agentEvidence: {
        note: "Could not run `node --test a.js`",
        outcome: "could_not_run",
        command: "node --test a.js",
      },
      runnerStatus: "failed",
      runnerReasonCodes: ["verification_unavailable"],
      changedFiles: ["packages/checks/src/builtins/http-check.js"],
      editsLanded: true,
    });

    expect(result.reasonCodes).toContain("tasklist_restored_after_verify_pass");
    expect(store.getSlice("taskList")).toEqual(campaign);
    expect(store.getSlice("priorExecutionTaskList")).toBeUndefined();
    expect(store.getSlice("taskList")?.title).not.toBe(VERIFY_REPAIR_DESK_TITLE);
  });

  it("does not seal when sealRepair is false for env noise", () => {
    const store = memoryStore({ taskList: campaign });
    const result = applyFinishDeskPolicy({
      store,
      mode: "agent",
      sealRepair: false,
      verifyPassed: false,
      finishStatus: "completed",
      agentEvidence: {
        note: "Could not run `node --test a.js`",
        outcome: "could_not_run",
        command: "node --test a.js",
      },
      changedFiles: [],
      editsLanded: false,
    });
    expect(result.reasonCodes).not.toContain("tasklist_sealed_verify_repair");
    expect(store.getSlice("taskList")).toEqual(campaign);
  });
});
