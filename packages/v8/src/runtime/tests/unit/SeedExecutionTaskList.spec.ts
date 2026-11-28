import { describe, expect, it } from "vitest";

import {
  extractObjectiveSliceTitles,
  isWeakSeededTaskList,
  seedExecutionTaskListFromObjective,
  seedExecutionTaskListFromPlanArtifact,
} from "../../helpers/plan";
import { TASK_LIST_SCHEMA_VERSION } from "../../../modules/task-list";

describe("seedExecutionTaskListFromObjective", () => {
  it("extracts numbered / headed slices from the objective", () => {
    const seeded = seedExecutionTaskListFromObjective(`
Do the following:

1. Desugar nested http.start
2. Add session continuity
3. Scaffold three React cases
`);
    expect(seeded.taskList?.purpose).toBe("execution");
    expect(seeded.taskList?.source).toBe("agent");
    expect(seeded.taskList?.items.length).toBeGreaterThanOrEqual(3);
    expect(seeded.taskList?.items[0]?.status).toBe("active");
    expect(seeded.taskList?.items[0]?.title).toMatch(/Desugar/i);
    expect(seeded.reasonCodes).toContain("tasklist_seeded_from_objective");
  });

  it("does not invent a desk from a raw ask with no LLM steppers", () => {
    const seeded = seedExecutionTaskListFromObjective(
      "please improve the checks package somehow",
    );
    expect(seeded.taskList).toBeUndefined();
    expect(seeded.reasonCodes).toContain("tasklist_seed_skipped_no_llm_steps");
  });

  it("does not paste a multi-paragraph brief as a fake checklist", () => {
    const brief = `I need you to redesign how HTTP checks work in this bench and then add a few React cases that prove the redesign.

Context from the repo:
HTTP checks live under packages/checks.`;
    const seeded = seedExecutionTaskListFromObjective(brief);
    expect(seeded.taskList).toBeUndefined();
    expect(extractObjectiveSliceTitles(brief)).toEqual([]);
  });

  it("extracts ### steppers under a ## plan section", () => {
    const planProse = `## Research findings

### HTTP checks today

- \`packages/checks/src/builtins/http-check.js\` compiles nested start.

## HTTP redesign plan

### First slice: compile-time desugar nested \`http.start\`

Target files:

- \`packages/checks/src/builtins/http-check.js\`

### Tests to add

- Compile nested http.start and assert order.
`;
    const titles = extractObjectiveSliceTitles(planProse);
    expect(titles.length).toBeGreaterThanOrEqual(2);
    expect(titles[0]).toMatch(/First slice/i);
    expect(titles[1]).toMatch(/Tests to add/i);
    const seeded = seedExecutionTaskListFromObjective(planProse);
    expect(seeded.taskList?.items.length).toBeGreaterThanOrEqual(2);
    expect(isWeakSeededTaskList(seeded.taskList)).toBe(false);
  });

  it("rejects verify-status residue as campaign steppers", () => {
    const residue = `Verification is green for this change set.

- **Exit code: 0**
- **14 passed, 0 failed, 2 skipped**

1. Exit code: 0
2. 14 passed, 0 failed, 2 skipped
`;
    expect(extractObjectiveSliceTitles(residue)).toEqual([]);
    const seeded = seedExecutionTaskListFromObjective(residue);
    expect(seeded.taskList).toBeUndefined();
    expect(seeded.reasonCodes).toContain("tasklist_seed_skipped_no_llm_steps");
  });

  it("marks evidence-only desks as weak", () => {
    expect(
      isWeakSeededTaskList({
        schemaVersion: TASK_LIST_SCHEMA_VERSION,
        source: "agent",
        purpose: "execution",
        title: "Campaign checklist",
        items: [
          { id: "slice_1", title: "Exit code: 0", status: "active" },
          {
            id: "slice_2",
            title: "14 passed, 0 failed, 2 skipped",
            status: "pending",
          },
        ],
      }),
    ).toBe(true);
  });

  it("prefers Recommended next-step numbered list from plan prose", () => {
    const planProse = `## Summary of findings

Lots of research prose here.

### Recommended next step

1. Implement the HTTP compile-time desugar in http-check.js.
2. Add compile tests asserting nested http.start expands.
3. Add a suite-lifecycle integration test.
4. Add the single genuinely new React case unsaved-changes-guard-*.
5. Report that optimistic-like-rollback-* already exist.

Postman is out of scope.`;
    const titles = extractObjectiveSliceTitles(planProse);
    expect(titles.length).toBeGreaterThanOrEqual(4);
    expect(titles[0]).toMatch(/HTTP compile-time desugar/i);
    expect(titles.some((t) => /Verify and finish remaining work/i.test(t))).toBe(
      false,
    );
    const seeded = seedExecutionTaskListFromObjective(planProse);
    expect(isWeakSeededTaskList(seeded.taskList)).toBe(false);
    expect(seeded.taskList?.items.length).toBeGreaterThanOrEqual(4);
  });
});

describe("seedExecutionTaskListFromPlanArtifact", () => {
  it("builds a desk from plan step intents when present", () => {
    const seeded = seedExecutionTaskListFromPlanArtifact({
      schemaVersion: 1,
      id: "plan_1",
      objective: "HTTP desugar + one React case",
      phases: [
        {
          id: "change",
          name: "Change",
          steps: [
            {
              id: "s1",
              intent: "Desugar nested http.start in http-check.js",
              actionSummary: "Return [start, http, stop]",
              targetRefs: ["packages/checks/src/builtins/http-check.js"],
            },
            {
              id: "s2",
              intent: "Add compile + suite-lifecycle tests",
              actionSummary: "Assert shared suite reuse",
              targetRefs: ["packages/checks/test/suite-lifecycle.test.js"],
            },
            {
              id: "s3",
              intent: "Add unsaved-changes-guard React case only",
              targetRefs: [],
            },
          ],
        },
      ],
    } as never);
    expect(seeded.taskList?.items.length).toBe(3);
    expect(seeded.taskList?.source).toBe("plan");
    expect(seeded.taskList?.items[0]?.status).toBe("active");
    expect(seeded.reasonCodes).toContain("tasklist_seeded_from_plan_steps");
  });
});

describe("isWeakSeededTaskList", () => {
  it("detects the historic 2-row verify twin", () => {
    expect(
      isWeakSeededTaskList({
        schemaVersion: TASK_LIST_SCHEMA_VERSION,
        source: "agent",
        purpose: "execution",
        items: [
          { id: "a", title: "Do the big ask…", status: "active" },
          {
            id: "b",
            title: "Verify and finish remaining work",
            status: "pending",
          },
        ],
      }),
    ).toBe(true);
  });

  it("detects a single truncated ask dump", () => {
    expect(
      isWeakSeededTaskList({
        schemaVersion: TASK_LIST_SCHEMA_VERSION,
        source: "agent",
        purpose: "execution",
        title: "Campaign checklist",
        items: [
          {
            id: "a",
            title: "I need you to redesign how HTTP checks work in this…",
            status: "active",
          },
        ],
      }),
    ).toBe(true);
  });
});
