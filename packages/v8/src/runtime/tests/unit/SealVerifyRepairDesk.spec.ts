import { describe, expect, it } from "vitest";

import {
  clearOrRestoreAfterVerifyPass,
  isVerifyRepairDesk,
  sealVerifyRepairDesk,
  shouldSealVerifyRepairDesk,
  REPAIR_FIX_ID,
  REPAIR_REVERIFY_ID,
  VERIFY_REPAIR_DESK_TITLE,
} from "../../helpers/task/SealVerifyRepairDesk";
import { TASK_LIST_SCHEMA_VERSION } from "../../../modules/task-list";

describe("sealVerifyRepairDesk", () => {
  it("seals a 2-slice Fix → Re-verify desk from the failure record", () => {
    const desk = sealVerifyRepairDesk({
      failureNote:
        "Failed via `node --test packages/checks/test/suite-lifecycle.test.js` (exit 1)",
      failedCommand: "node --test packages/checks/test/suite-lifecycle.test.js",
      hint: "AssertionError: expected true",
      changedFiles: ["packages/checks/src/suite.js"],
    });

    expect(desk.title).toBe(VERIFY_REPAIR_DESK_TITLE);
    expect(desk.purpose).toBe("execution");
    expect(desk.items).toHaveLength(2);
    expect(desk.items[0]).toMatchObject({
      id: REPAIR_FIX_ID,
      status: "active",
    });
    expect(desk.items[0]!.title).toMatch(/Address verification failures/);
    expect(desk.items[0]!.title).toContain("suite-lifecycle.test.js");
    expect(desk.items[0]!.write).toEqual(["packages/checks/src/suite.js"]);
    expect(desk.items[1]).toMatchObject({
      id: REPAIR_REVERIFY_ID,
      status: "pending",
      title: "Re-run verification for this change set",
    });
    expect(desk.items[1]!.detail).toContain("suite-lifecycle.test.js");
    expect(isVerifyRepairDesk(desk)).toBe(true);
  });

  it("shouldSealVerifyRepairDesk keys off agent fail or runner fail", () => {
    expect(
      shouldSealVerifyRepairDesk({
        agentEvidence: {
          note: "Failed via `node --test a.js` (exit 1)",
          outcome: "failed",
          command: "node --test a.js",
          exitCode: 1,
        },
      }),
    ).toBe(true);
    expect(
      shouldSealVerifyRepairDesk({ runnerStatus: "failed" }),
    ).toBe(true);
    expect(
      shouldSealVerifyRepairDesk({
        agentEvidence: {
          note: "Passed via `node --test a.js`",
          outcome: "passed",
          command: "node --test a.js",
          exitCode: 0,
        },
        runnerStatus: "unavailable",
      }),
    ).toBe(false);
  });

  it("restores prior campaign after verify pass", () => {
    const repair = sealVerifyRepairDesk({
      failureNote: "Failed via `pnpm test` (exit 1)",
      failedCommand: "pnpm test",
    });
    const prior = {
      schemaVersion: TASK_LIST_SCHEMA_VERSION,
      source: "plan" as const,
      purpose: "execution" as const,
      items: [
        { id: "s2", title: "Next feature slice", status: "pending" as const },
      ],
    };
    const result = clearOrRestoreAfterVerifyPass({
      current: repair,
      prior,
    });
    expect(result.restored).toBe(true);
    expect(result.taskList).toEqual(prior);
    expect(result.reasonCodes).toContain("tasklist_restored_after_verify_pass");
  });
});
