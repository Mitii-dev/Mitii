import { describe, expect, it } from "vitest";

import {
  TASK_LIST_SCHEMA_VERSION,
  TaskListError,
  TaskListPipeline,
  parseTaskListMarkdown,
  serializeTaskListMarkdown,
  taskListApplyInputSchema,
  taskListApplyResultSchema,
  taskListSchema,
} from "../../index";

describe("TaskList contract", () => {
  const pipeline = new TaskListPipeline();

  it("accepts a valid replace and returns schema version 1", () => {
    const input = taskListApplyInputSchema.parse({
      schemaVersion: TASK_LIST_SCHEMA_VERSION,
      source: "agent",
      operation: {
        type: "replace",
        items: [
          { title: "Read entrypoint" },
          { title: "Patch handler", status: "active" },
        ],
      },
    });
    const result = pipeline.apply(input);
    expect(taskListApplyResultSchema.parse(result).status).toBe("applied");
    expect(result.taskList?.schemaVersion).toBe(1);
    expect(result.taskList?.items).toHaveLength(2);
    expect(result.taskList?.items[1]?.status).toBe("active");
    expect(result.reasonCodes).toContain("task_list_replaced");
    expect(result.taskList?.source).toBe("agent");
    const completed = result.taskList!.items.filter(
      (item) => item.status === "done",
    ).length;
    expect(completed).toBe(0);
  });

  it("rejects invalid apply input at the boundary", () => {
    expect(() =>
      pipeline.apply({
        schemaVersion: 1,
        source: "agent",
        operation: { type: "replace", items: [] },
      } as never),
    ).toThrow(TaskListError);
  });

  it("rejects a patch against an empty list", () => {
    const result = pipeline.apply(
      taskListApplyInputSchema.parse({
        schemaVersion: 1,
        source: "agent",
        operation: {
          type: "patch",
          items: [{ id: "missing", status: "done" }],
        },
      }),
    );
    expect(result.status).toBe("rejected");
    expect(result.reasonCodes).toContain("task_list_invalid");
    expect(result.taskList).toBeUndefined();
  });

  it("round-trips markdown checkboxes without exporting internals", () => {
    const created = pipeline.apply(
      taskListApplyInputSchema.parse({
        schemaVersion: 1,
        source: "user",
        operation: {
          type: "replace",
          items: [
            { title: "Inspect module", status: "done" },
            { title: "Write tests", status: "active" },
          ],
        },
      }),
    );
    const markdown = serializeTaskListMarkdown(created.taskList!);
    const parsed = parseTaskListMarkdown(markdown, "user");
    expect(taskListSchema.parse(parsed).items.map((item) => item.status)).toEqual(
      ["done", "active"],
    );
  });
});
