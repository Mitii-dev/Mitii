import { describe, expect, it } from "vitest";

import { TASK_LIST_SCHEMA_VERSION, TaskListPipeline } from "../../index";
import { taskListApplyInputSchema, taskListSchema } from "../../contracts";

function seed(pipeline: TaskListPipeline) {
  return pipeline.apply(
    taskListApplyInputSchema.parse({
      schemaVersion: TASK_LIST_SCHEMA_VERSION,
      source: "agent",
      operation: {
        type: "replace",
        items: [
          { id: "one", title: "One", status: "done" },
          { id: "two", title: "Two", status: "active" },
          { id: "three", title: "Three" },
        ],
      },
    }),
  ).taskList!;
}

describe("applyTaskListUpdate", () => {
  const pipeline = new TaskListPipeline();

  it("patches a known id to done without completing siblings", () => {
    const current = seed(pipeline);
    const result = pipeline.apply(
      taskListApplyInputSchema.parse({
        schemaVersion: 1,
        current,
        source: "agent",
        operation: {
          type: "patch",
          items: [{ id: "two", status: "done" }],
        },
      }),
    );
    expect(result.status).toBe("applied");
    expect(result.taskList?.items.map((item) => item.status)).toEqual([
      "done",
      "done",
      "pending",
    ]);
    expect(result.reasonCodes).toContain("task_list_patched");
  });

  it("keeps at most one active item on replace", () => {
    const result = pipeline.apply(
      taskListApplyInputSchema.parse({
        schemaVersion: 1,
        source: "agent",
        operation: {
          type: "replace",
          items: [
            { title: "A", status: "active" },
            { title: "B", status: "active" },
          ],
        },
      }),
    );
    expect(result.status).toBe("applied");
    const statuses = result.taskList!.items.map((item) => item.status);
    expect(statuses.filter((status) => status === "active")).toHaveLength(1);
    expect(taskListSchema.parse(result.taskList).items[1]?.status).toBe("active");
  });

  it("caps replace at eight items", () => {
    const result = pipeline.apply(
      taskListApplyInputSchema.parse({
        schemaVersion: 1,
        source: "agent",
        operation: {
          type: "replace",
          items: Array.from({ length: 8 }, (_, index) => ({
            title: `Task ${index + 1}`,
          })),
        },
      }),
    );
    expect(result.taskList?.items).toHaveLength(8);
  });

  it("clears the list without inventing done items", () => {
    const current = seed(pipeline);
    const result = pipeline.apply(
      taskListApplyInputSchema.parse({
        schemaVersion: 1,
        current,
        source: "user",
        operation: { type: "clear" },
      }),
    );
    expect(result.taskList?.items).toEqual([]);
    expect(result.reasonCodes).toContain("task_list_cleared");
  });

  it("preserves plan sourceRef through patches", () => {
    const current = taskListSchema.parse({
      schemaVersion: 1,
      source: "plan",
      items: [
        {
          id: "change-widget",
          title: "Change widget behavior",
          status: "active",
          sourceRef: "plan-step-1",
        },
        {
          id: "verify-widget",
          title: "Verify widget behavior",
          status: "pending",
          sourceRef: "plan-step-2",
        },
      ],
    });
    const result = pipeline.apply(
      taskListApplyInputSchema.parse({
        schemaVersion: 1,
        current,
        source: "plan",
        operation: {
          type: "patch",
          items: [
            { id: "change-widget", status: "done" },
            { id: "verify-widget", status: "active" },
          ],
        },
      }),
    );
    expect(result.taskList?.items.map((item) => item.sourceRef)).toEqual([
      "plan-step-1",
      "plan-step-2",
    ]);
  });
});
