import { describe, expect, it } from "vitest";

import type { TaskList } from "../../../modules/task-list";
import {
  buildBriefcase,
  packTurn,
} from "../../helpers/store";
import {
  applyTaskSettleToStore,
  formatTaskListForBriefcase,
  updateTaskListOnSettle,
} from "../../helpers/task";
import {
  classifyChangedPaths,
  selectPolicyForChangedPaths,
  selectVerificationPolicy,
} from "../../helpers/verify";
import {
  POLICY_GATE_OWNER_MAP,
  resolvePolicyGateOwner,
} from "../../helpers/gates";
import { StoreManager } from "../../helpers/store";
import { buildFullContextBundle } from "../../helpers/enrich";

function sampleList(): TaskList {
  return {
    schemaVersion: 1,
    source: "plan",
    items: [
      {
        id: "t1",
        title: "Patch login",
        status: "active",
        write: ["src/auth/Login.ts"],
      },
      {
        id: "t2",
        title: "Add test",
        status: "pending",
        write: ["src/auth/Login.test.ts"],
      },
    ],
  };
}

describe("S11-BRIEF / S11-TASK / S12-SELECT / S10-POLICY-MAP", () => {
  it("formatTaskListForBriefcase attaches prompt + working set", () => {
    const fmt = formatTaskListForBriefcase(sampleList());
    expect(fmt.promptBlock).toContain("<task_list");
    expect(fmt.promptBlock).toContain("t1:");
    expect(fmt.workingSet).toContain("working_set");
    expect(fmt.reasonCodes).toContain("briefcase_task_list_attached");
  });

  it("packTurn / buildBriefcase put TaskList in volatile slot", () => {
    const bundle = buildFullContextBundle({
      route: "execute",
      grantProfile: "write",
      projectRulesText: "use pnpm",
      skillInstructions: ["skill:a"],
      taskListPresent: true,
    });
    const packed = packTurn({
      messages: [{ role: "user", content: "go" }],
      grant: { allowedTools: ["apply_patch"] },
      contextBundle: bundle,
      taskList: sampleList(),
    });
    const volatile = packed.briefcaseSlots?.volatile.join("\n") ?? "";
    expect(volatile).toContain("t1:");
    expect(volatile).not.toBe("taskList: present");

    const brief = buildBriefcase({
      message: "go",
      grant: { allowedTools: ["read_file"] },
      contextBundle: bundle,
      taskList: sampleList(),
    });
    expect(brief.reasonCodes).toContain("briefcase_built");
    expect(brief.reasonCodes).toContain("briefcase_task_list_attached");
  });

  it("updateTaskListOnSettle advances when write paths match", () => {
    const result = updateTaskListOnSettle({
      taskList: sampleList(),
      changedPaths: ["src/auth/Login.ts"],
    });
    expect(result.advanced).toBe(true);
    expect(result.taskList.items[0]?.status).toBe("done");
    expect(result.taskList.items[1]?.status).toBe("active");
    expect(result.handoffs.length).toBe(1);
  });

  it("applyTaskSettleToStore persists after mutate", () => {
    const store = StoreManager.create("settle-1");
    store.setSlice("taskList", sampleList());
    const codes = applyTaskSettleToStore({
      store,
      args: { path: "src/auth/Login.ts" },
      effect: "mutate",
      status: "succeeded",
    });
    expect(codes).toContain("task_settle_advanced");
    const list = store.getSlice<TaskList>("taskList");
    expect(list?.items[0]?.status).toBe("done");
  });

  it("change-class select table classifies docs vs logic", () => {
    expect(classifyChangedPaths(["README.md", "docs/a.md"])).toBe("docs");
    expect(classifyChangedPaths(["src/foo.ts"])).toBe("logic");
    expect(selectPolicyForChangedPaths(["README.md"]).skipTests).toBe(true);
    expect(selectPolicyForChangedPaths(["src/foo.ts"]).skipTests).toBe(false);
  });

  it("selectVerificationPolicy uses change-class preferred checks", () => {
    const docs = selectVerificationPolicy({
      runId: "v1",
      verification: { required: true },
      changedPaths: ["README.md"],
    });
    expect(docs.skip).toBe(false);
    expect(docs.request?.checks).not.toContain("tests");
    expect(docs.reasonCodes).toContain("verify_select_docs_skip_tests");
    expect(docs.reasonCodes).toContain("verify_change_class_docs");

    const logic = selectVerificationPolicy({
      runId: "v2",
      verification: { required: true },
      changedPaths: ["src/service.ts"],
    });
    expect(logic.request?.checks).toContain("tests");
    expect(logic.reasonCodes).toContain("verify_select_logic_tests");
  });

  it("POLICY_GATE_OWNER_MAP covers §10.3.2 concerns", () => {
    expect(POLICY_GATE_OWNER_MAP.length).toBeGreaterThanOrEqual(8);
    expect(resolvePolicyGateOwner("blast_radius")?.owner).toContain(
      "blast-radius",
    );
    expect(
      resolvePolicyGateOwner("verification_regression")?.escalateKinds,
    ).toContain("continue_required");
  });
});
