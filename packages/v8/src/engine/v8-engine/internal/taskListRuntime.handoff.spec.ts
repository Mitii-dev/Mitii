import { describe, expect, it } from "vitest";

import { maybeAutoAdvanceTaskList } from "./taskListRuntime";
import type { TaskListRef } from "./updateTodosRuntime";

describe("maybeAutoAdvanceTaskList S13-ENGINE handoffs", () => {
  it("records a runtime handoff note on the TaskListRef when advancing", () => {
    const taskListRef: TaskListRef = {};
    const result = maybeAutoAdvanceTaskList({
      enabled: true,
      current: {
        schemaVersion: 1,
        source: "plan",
        purpose: "execution",
        items: [
          {
            id: "a",
            title: "Patch src/auth.ts",
            status: "active",
            write: ["src/auth.ts"],
          },
          {
            id: "b",
            title: "Next step",
            status: "pending",
            write: ["src/other.ts"],
          },
        ],
      },
      toolStatus: "succeeded",
      isMutatingTool: true,
      changedFiles: ["src/auth.ts"],
      taskListRef,
    });

    expect(result.advanced).toBe(true);
    expect(result.handoff?.fromTaskId).toBe("a");
    expect(result.handoff?.toTaskId).toBe("b");
    expect(result.handoff?.artifactsWritten).toContain("src/auth.ts");
    expect(taskListRef.handoffs).toHaveLength(1);
    expect(taskListRef.handoffs?.[0]?.fromTaskId).toBe("a");
  });
});
