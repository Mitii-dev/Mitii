import { describe, expect, it } from "vitest";

import {
  collectCompletedTaskPaths,
  extractDiagnosticCodeHint,
  itemWriteTargetsMatchChangedFiles,
  taskItemPaths,
  taskPathsMatch,
} from "../../actions/TaskItemPaths";
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

describe("taskPathsMatch", () => {
  it("treats package-prefixed paths as matching shorter write hints", () => {
    expect(
      taskPathsMatch("src/Button.tsx", "packages/mui-builder/src/Button.tsx"),
    ).toBe(true);
    expect(taskPathsMatch("src/a.ts", "src/b.ts")).toBe(false);
  });
});

describe("itemWriteTargetsMatchChangedFiles", () => {
  it("matches mutations under the same package root as write/Scope", () => {
    expect(
      itemWriteTargetsMatchChangedFiles(
        {
          title: "Change: draft package files",
          detail: "Scope: packages/mui-builder/src/index.ts",
          write: ["packages/mui-builder/src/index.ts"],
        },
        ["packages/mui-builder/src/Button.tsx"],
      ),
    ).toBe(true);
  });

  it("does not match a different package root", () => {
    expect(
      itemWriteTargetsMatchChangedFiles(
        {
          title: "Change: draft",
          detail: "Scope: packages/formik-form-builder/src/index.ts",
          write: ["packages/formik-form-builder/src/index.ts"],
        },
        ["packages/mui-builder/src/index.ts"],
      ),
    ).toBe(false);
  });
});

describe("extractDiagnosticCodeHint", () => {
  it("pulls TS codes from plan-style titles", () => {
    expect(extractDiagnosticCodeHint("Change: Fix TS2339 in Form.tsx")).toBe(
      "TS2339",
    );
    expect(extractDiagnosticCodeHint("Fix 2305 in imports")).toBe("TS2305");
    expect(extractDiagnosticCodeHint("Update src/a.ts")).toBeUndefined();
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
