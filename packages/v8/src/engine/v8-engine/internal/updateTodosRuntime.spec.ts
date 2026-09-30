import { describe, expect, it } from "vitest";

import { UPDATE_TODOS_TOOL_NAME } from "../../../modules/task-list";
import {
  attachTaskListTool,
  shouldRemindTodoUpdate,
  UPDATE_TODOS_TOOL_DEFINITION,
} from "./updateTodosRuntime";

describe("attachTaskListTool", () => {
  const baseTools = [
    {
      name: "read_file",
      description: "Read a file",
      inputSchema: { type: "object", properties: {} },
    },
  ];

  it("attaches update_todos only in agent mode", () => {
    const attached = attachTaskListTool({ mode: "agent", tools: baseTools });
    expect(attached.map((tool) => tool.name)).toEqual([
      "read_file",
      UPDATE_TODOS_TOOL_NAME,
    ]);
    expect(
      attached.find((tool) => tool.name === UPDATE_TODOS_TOOL_NAME)?.description,
    ).toContain("multiple active items are rejected");
  });

  it("does not attach update_todos in plan or ask mode", () => {
    expect(
      attachTaskListTool({ mode: "plan", tools: baseTools }).map((tool) => tool.name),
    ).toEqual(["read_file"]);
    expect(
      attachTaskListTool({ mode: "ask", tools: baseTools }).map((tool) => tool.name),
    ).toEqual(["read_file"]);
  });

  it("does not duplicate when already present", () => {
    const attached = attachTaskListTool({
      mode: "agent",
      tools: [...baseTools, UPDATE_TODOS_TOOL_DEFINITION],
    });
    expect(
      attached.filter((tool) => tool.name === UPDATE_TODOS_TOOL_NAME),
    ).toHaveLength(1);
  });
});

describe("shouldRemindTodoUpdate", () => {
  const openList = {
    schemaVersion: 1 as const,
    source: "agent" as const,
    purpose: "execution" as const,
    items: [
      { id: "a", title: "Fix a.ts", status: "active" as const },
      { id: "b", title: "Fix b.ts", status: "pending" as const },
    ],
  };

  it("reminds after the interval when the checklist is stale", () => {
    expect(
      shouldRemindTodoUpdate({
        taskList: openList,
        lastUpdatedAtModelCall: 1,
        currentModelCall: 7,
        intervalTurns: 6,
      }),
    ).toBe(true);
    expect(
      shouldRemindTodoUpdate({
        taskList: openList,
        lastUpdatedAtModelCall: 1,
        currentModelCall: 6,
        intervalTurns: 6,
      }),
    ).toBe(false);
  });

  it("does not remind for discovery lists or empty lists", () => {
    expect(
      shouldRemindTodoUpdate({
        taskList: { ...openList, purpose: "discovery", source: "discovery" },
        lastUpdatedAtModelCall: 0,
        currentModelCall: 20,
      }),
    ).toBe(false);
    expect(
      shouldRemindTodoUpdate({
        taskList: { ...openList, items: [] },
        currentModelCall: 20,
      }),
    ).toBe(false);
  });
});
