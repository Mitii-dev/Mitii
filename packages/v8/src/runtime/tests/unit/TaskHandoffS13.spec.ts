import { describe, expect, it } from "vitest";

import type { TaskList } from "../../../modules/task-list";
import {
  advanceTaskWithHandoff,
  appendTaskHandoff,
  buildTaskHandoffNote,
  reorderTaskListForSteer,
  sanitizeHandoffText,
  selectBriefcaseHandoffPeaks,
  softWarnTaskListLength,
} from "../../helpers/handoff";
import { buildFullContextBundle } from "../../helpers/enrich";
import { StoreManager } from "../../helpers/store";
import { enrichContext } from "../../flow/steps/9-EnrichContext";

function sampleList(overrides?: Partial<TaskList>): TaskList {
  return {
    schemaVersion: 1,
    source: "plan",
    purpose: "execution",
    items: [
      {
        id: "t1",
        title: "Write helper",
        status: "active",
        write: ["src/a.ts"],
        mustRead: ["src/a.ts"],
      },
      {
        id: "t2",
        title: "Wire tests",
        status: "pending",
        mustRead: ["src/a.test.ts"],
      },
      {
        id: "t3",
        title: "Docs",
        status: "pending",
      },
    ],
    ...overrides,
  };
}

describe("S13 TaskList handoff", () => {
  it("buildTaskHandoffNote sanitizes secrets and truncates", () => {
    const note = buildTaskHandoffNote({
      fromTaskId: "t1",
      toTaskId: "t2",
      doneSummary: "Saved api_key=super-secret-value into config",
      artifactsWritten: ["src/a.ts"],
    });
    expect(note.doneSummary).toContain("[redacted]");
    expect(note.doneSummary).not.toContain("super-secret-value");
    expect(note.fromTaskId).toBe("t1");
    expect(note.toTaskId).toBe("t2");
  });

  it("advanceTaskWithHandoff completes and activates next", () => {
    const result = advanceTaskWithHandoff({
      taskList: sampleList(),
      action: "complete",
      doneSummary: "Helper landed.",
      artifactsWritten: ["src/a.ts"],
    });
    expect(result.taskList.items[0]?.status).toBe("done");
    expect(result.taskList.items[1]?.status).toBe("active");
    expect(result.note.toTaskId).toBe("t2");
    expect(result.reasonCodes).toContain("task_handoff_completed");
    expect(result.reasonCodes).toContain("task_handoff_advanced");
  });

  it("skip adds user_skipped blocker and advances", () => {
    const result = advanceTaskWithHandoff({
      taskList: sampleList(),
      action: "skip",
      doneSummary: "User skipped screen 1.",
    });
    expect(result.taskList.items[0]?.status).toBe("skipped");
    expect(result.note.blockersRemaining).toContain("user_skipped");
    expect(result.reasonCodes).toContain("task_handoff_skipped");
  });

  it("reorderTaskListForSteer prefers requested task", () => {
    const result = reorderTaskListForSteer({
      taskList: sampleList(),
      preferTaskId: "t3",
    });
    expect(result.reordered).toBe(true);
    expect(result.taskList.items.find((i) => i.status === "active")?.id).toBe(
      "t3",
    );
    expect(result.reasonCodes).toContain("task_steer_reordered");
  });

  it("selectBriefcaseHandoffPeaks prefers active + previous + objective", () => {
    const list = sampleList();
    const note = buildTaskHandoffNote({
      fromTaskId: "t0",
      toTaskId: "t1",
      doneSummary: "Prior work done.",
      nextMustRead: ["src/prior.ts"],
    });
    const peaks = selectBriefcaseHandoffPeaks({
      taskList: list,
      handoffs: [note],
      planObjective: "Ship handoff linked list",
    });
    expect(peaks.activeTaskId).toBe("t1");
    expect(peaks.previousHandoffSummary).toContain("Prior work");
    expect(peaks.planObjective).toContain("Ship handoff");
    expect(peaks.nextMustRead).toEqual(
      expect.arrayContaining(["src/prior.ts", "src/a.ts"]),
    );
  });

  it("softWarnTaskListLength warns above 8", () => {
    const items = Array.from({ length: 9 }, (_, i) => ({
      id: `t${i}`,
      title: `Task ${i}`,
      status: i === 0 ? ("active" as const) : ("pending" as const),
    }));
    expect(softWarnTaskListLength({ schemaVersion: 1, source: "plan", items }).warned).toBe(
      true,
    );
  });

  it("appendTaskHandoff caps history", () => {
    let history = appendTaskHandoff(
      undefined,
      buildTaskHandoffNote({
        fromTaskId: "a",
        doneSummary: "one",
      }),
    );
    for (let i = 0; i < 30; i += 1) {
      history = appendTaskHandoff(
        history,
        buildTaskHandoffNote({
          fromTaskId: `t${i}`,
          doneSummary: `n${i}`,
        }),
      );
    }
    expect(history.length).toBeLessThanOrEqual(24);
  });

  it("enrichContext attaches handoffPeaks from store", () => {
    const store = StoreManager.create("s13");
    store.setSlice("assessment", {
      primaryTaskIntent: "feature",
      clarityConfidence: 0.9,
      planningHint: "none",
      risk: "low",
      difficulty: "easy",
      reasonCodes: [],
    });
    store.setSlice("decision", {
      route: "execute",
      grantProfile: "agent_execute",
      plateId: "p",
      planningDepth: "none",
      planGate: "none",
      runDisposition: "continue",
      routeBody: { runVerify: true, reasonCodes: [] },
      pathScopes: [],
      toolGrant: { schemaVersion: 1, profile: "agent_execute", tools: [] },
      verification: {
        required: true,
        minimumEvidence: [],
        allowUnavailable: true,
      },
      repositoryContextRequired: true,
      rationale: "test",
      reasonCodes: [],
    });
    store.setSlice("taskList", sampleList());
    store.setSlice("taskHandoffs", [
      buildTaskHandoffNote({
        fromTaskId: "t0",
        toTaskId: "t1",
        doneSummary: "Seeded.",
      }),
    ]);
    store.setSlice("planArtifact", {
      id: "plan-1",
      objective: "Linked handoffs",
    });

    const bundle = enrichContext({
      store,
      input: { message: "continue tasks" },
      mode: "agent",
    });
    expect(bundle.handoffPeaks?.activeTaskId).toBe("t1");
    expect(bundle.handoffPeaks?.previousHandoffSummary).toContain("Seeded");
    expect(bundle.handoffPeaks?.planObjective).toContain("Linked handoffs");
    expect(bundle.reasonCodes).toContain("enrich_handoff_peaks");
  });

  it("sanitizeHandoffText is idempotent on clean text", () => {
    expect(sanitizeHandoffText("Clean summary.")).toBe("Clean summary.");
  });

  it("buildFullContextBundle embeds peaks in summary", () => {
    const bundle = buildFullContextBundle({
      route: "execute",
      grantProfile: "agent_execute",
      handoffPeaks: {
        activeTaskId: "t2",
        activeTaskTitle: "Wire",
        previousHandoffSummary: "done",
        nextMustRead: ["a.ts"],
      },
    });
    expect(bundle.summary).toContain("activeTask=t2");
    expect(bundle.handoffPeaks?.activeTaskId).toBe("t2");
  });
});
