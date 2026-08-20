import { describe, expect, it } from "vitest";

import { collectCompletedTaskPaths, taskItemPaths } from "../../actions/TaskItemPaths";
import type { TaskList } from "../../contracts";

describe("taskItemPaths", () => {
  it("prefers explicit write/mustRead/affected over title tokens", () => {
    expect(
      taskItemPaths({
        title: "Also mentions src/other.ts",
        write: ["src/auth/Login.ts"],
        mustRead: ["src/auth/types.ts"],
        affected: ["src/auth/Login.test.ts"],
      }),
    ).toEqual([
      "src/auth/Login.ts",
      "src/auth/types.ts",
      "src/auth/Login.test.ts",
    ]);
  });

  it("falls back to file-like tokens in title and detail", () => {
    expect(
      taskItemPaths({
        title: "Patch src/widget.ts",
        detail: "Scope: src/widget.test.ts",
      }),
    ).toEqual(["src/widget.ts", "src/widget.test.ts"]);
  });
});

describe("collectCompletedTaskPaths", () => {
  it("omits paths still needed by remaining rows", () => {
    const taskList: TaskList = {
      schemaVersion: 1,
      source: "plan",
      items: [
        {
          id: "a",
          title: "Fix Login",
          status: "done",
          write: ["src/auth/Login.ts"],
          mustRead: ["src/auth/types.ts"],
        },
        {
          id: "b",
          title: "Fix types",
          status: "active",
          write: ["src/auth/types.ts"],
        },
      ],
    };
    expect(collectCompletedTaskPaths(taskList)).toEqual(["src/auth/Login.ts"]);
  });
});
