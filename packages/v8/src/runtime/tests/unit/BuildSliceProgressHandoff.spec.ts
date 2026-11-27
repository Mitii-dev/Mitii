import { describe, expect, it } from "vitest";

import {
  buildSliceProgressHandoff,
  formatOpenChecklistLeftoverAnswer,
} from "../../helpers/task/BuildSliceProgressHandoff";
import { TASK_LIST_SCHEMA_VERSION } from "../../../modules/task-list";

describe("buildSliceProgressHandoff", () => {
  const taskList = {
    schemaVersion: TASK_LIST_SCHEMA_VERSION,
    source: "plan" as const,
    items: [
      {
        id: "t1",
        title: "HTTP desugar",
        status: "done" as const,
        sourceRef: "s1",
      },
      {
        id: "t2",
        title: "Add React cases",
        status: "pending" as const,
        sourceRef: "s2",
        detail: "Generate optimistic-favorite",
      },
    ],
  };

  it("builds progress + continue_checklist nextAction for open items", () => {
    const handoff = buildSliceProgressHandoff({
      plan: {
        objective: "HTTP + React",
        phases: [
          {
            name: "Slice",
            steps: [
              { id: "s1", intent: "HTTP" },
              { id: "s2", intent: "React" },
            ],
          },
        ],
      },
      taskList,
      completedPlanStepIds: ["s1"],
      appendLeftover: true,
      advancedThisTurnIds: ["t1"],
    });

    expect(handoff.progress).toMatchObject({
      planCompletedCount: 1,
      planTotalCount: 2,
      doneCount: 1,
      pendingCount: 1,
      nextTitle: "Add React cases",
      openTitles: ["Add React cases"],
    });
    expect(handoff.nextAction).toEqual({
      kind: "continue_checklist",
      prompt: "Continue with the next plan item: Add React cases",
    });
    expect(handoff.completedPlanStepIds).toEqual(["s1"]);
    expect(handoff.leftoverAnswer).toMatch(
      /Implementation of \*\*HTTP desugar\*\* is done/i,
    );
    expect(handoff.leftoverAnswer).toMatch(
      /Next we still have \*\*Add React cases\*\* to implement/i,
    );
    expect(handoff.leftoverAnswer).toMatch(/Want me to start the next slice/i);
    expect(handoff.leftoverAnswer).toContain("Say **continue**");
  });

  it("honest leftover only claims advancedThisTurnIds", () => {
    const multiDone = {
      ...taskList,
      items: [
        {
          id: "t0",
          title: "Earlier slice",
          status: "done" as const,
          sourceRef: "s0",
        },
        ...taskList.items,
      ],
    };
    const leftover = formatOpenChecklistLeftoverAnswer(multiDone, {
      advancedThisTurnIds: ["t1"],
    });
    expect(leftover).toContain("HTTP desugar");
    expect(leftover).not.toContain("Earlier slice");
  });

  it("rewrites generic fallback titles using changed files", () => {
    const leftover = formatOpenChecklistLeftoverAnswer(
      {
        schemaVersion: TASK_LIST_SCHEMA_VERSION,
        source: "agent",
        purpose: "execution",
        items: [
          {
            id: "slice_1",
            title: "Implement the first safe slice",
            status: "done",
          },
          {
            id: "slice_2",
            title: "Complete remaining requested work",
            status: "pending",
          },
        ],
      },
      {
        advancedThisTurnIds: ["slice_1"],
        changedFiles: [
          "packages/checks/src/builtins/http-check.js",
          "packages/checks/test/http-desugar.test.js",
        ],
        verifyNote: "Passed via `node --test packages/checks/test/http-desugar.test.js`",
      },
    );
    expect(leftover).toMatch(/packages\/checks/);
    expect(leftover).toMatch(/http-check\.js/);
    expect(leftover).toMatch(/remaining work around packages\/checks/);
    expect(leftover).toMatch(/Passed via/);
    expect(leftover).not.toMatch(/Implement the first safe slice/);
    expect(leftover).not.toMatch(/Complete remaining requested work/);
  });

  it("prefers campaign nextAction when nextPlanPhaseOffer is set", () => {
    const handoff = buildSliceProgressHandoff({
      taskList,
      nextPlanPhaseOffer: "## Next phase available\n\n- B) Scope B",
    });
    expect(handoff.nextAction?.kind).toBe("next_campaign_scope");
  });

  it("formatOpenChecklistLeftoverAnswer is empty when nothing open", () => {
    expect(
      formatOpenChecklistLeftoverAnswer({
        schemaVersion: TASK_LIST_SCHEMA_VERSION,
        source: "agent",
        items: [
          { id: "a", title: "Done", status: "done" },
        ],
      }),
    ).toBe("");
  });

  it("failed verify leftover does not claim the slice is done", () => {
    const leftover = formatOpenChecklistLeftoverAnswer(
      {
        schemaVersion: TASK_LIST_SCHEMA_VERSION,
        source: "agent",
        purpose: "execution",
        title: "Verification repair",
        items: [
          {
            id: "repair_fix",
            title: "Address verification failures: node --test a.test.js",
            status: "active",
          },
          {
            id: "repair_reverify",
            title: "Re-run verification for this change set",
            status: "pending",
          },
        ],
      },
      {
        changedFiles: ["packages/checks/src/suite.js"],
        verifyNote:
          "Failed via `node --test packages/checks/test/a.test.js` (exit 1)",
      },
    );
    expect(leftover).toMatch(/landed this turn, but verification failed/i);
    expect(leftover).toMatch(/Address verification failures/);
    expect(leftover).toMatch(/Re-run verification/);
    expect(leftover).toMatch(/Failed via/);
    expect(leftover).not.toMatch(/is done\./);
  });
});
