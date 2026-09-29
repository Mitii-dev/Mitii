import { describe, expect, it } from "vitest";

import { TASK_LIST_SCHEMA_VERSION, TaskListPipeline } from "../../index";
import { clipTaskTitle } from "../../actions/ApplyTaskListUpdate";
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

  it("rejects replace when more than one item is active", () => {
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
    expect(result.status).toBe("rejected");
    expect(result.reasonCodes).toContain("task_list_invalid");
    expect(result.warnings.some((warning) => /at most 1 task can be active/i.test(warning))).toBe(
      true,
    );
  });

  it("rejects patch that would leave multiple active items", () => {
    const current = seed(pipeline);
    const result = pipeline.apply(
      taskListApplyInputSchema.parse({
        schemaVersion: 1,
        current,
        source: "agent",
        operation: {
          type: "patch",
          items: [{ id: "three", status: "active" }],
        },
      }),
    );
    expect(result.status).toBe("rejected");
    expect(result.reasonCodes).toContain("task_list_invalid");
  });

  it("rejects illegal status transitions such as done → blocked", () => {
    const current = seed(pipeline);
    const result = pipeline.apply(
      taskListApplyInputSchema.parse({
        schemaVersion: 1,
        current,
        source: "agent",
        operation: {
          type: "patch",
          items: [{ id: "one", status: "blocked" }],
        },
      }),
    );
    expect(result.status).toBe("rejected");
    expect(result.reasonCodes).toContain("task_list_status_transition_invalid");
  });

  it("allows pending → active → done progress patches", () => {
    const current = seed(pipeline);
    const activated = pipeline.apply(
      taskListApplyInputSchema.parse({
        schemaVersion: 1,
        current,
        source: "agent",
        operation: {
          type: "patch",
          items: [
            { id: "two", status: "done" },
            { id: "three", status: "active" },
          ],
        },
      }),
    );
    expect(activated.status).toBe("applied");
    expect(activated.taskList?.items.map((item) => item.status)).toEqual([
      "done",
      "done",
      "active",
    ]);
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

  it("creates a temporary discovery list that is not an execution checklist", () => {
    const list = pipeline.createDiscoveryList();
    expect(taskListSchema.parse(list).source).toBe("discovery");
    expect(list.purpose).toBe("discovery");
    expect(list.title).toBe("Investigating request");
    expect(list.items.map((item) => item.id)).toEqual([
      "find-entrypoint",
      "read-state",
      "identify-checks",
    ]);
    expect(list.items[0]?.status).toBe("active");
    expect(list.items.filter((item) => item.status === "done")).toHaveLength(0);
  });
});

describe("clipTaskTitle", () => {
  it("keeps short titles and preserves a path token when clipping", () => {
    expect(clipTaskTitle("Fix Login.ts").title).toBe("Fix Login.ts");
    const long =
      "Thoroughly update the authentication session helper for edge cases in src/auth/session.ts today";
    const clipped = clipTaskTitle(long);
    expect(clipped.clipped).toBe(true);
    expect(clipped.title.split(" ").length).toBeLessThanOrEqual(7);
    expect(clipped.title).toMatch(/session\.ts/);
  });
});
