import { describe, expect, it } from "vitest";

import { TOOL_RUNTIME_SCHEMA_VERSION } from "../../../tool-runtime";
import type { ToolResult } from "../../../tool-runtime";

import { ToolCallCache, rebaseToolResult } from "../ToolCallCache";

function result(callId: string, output: string): ToolResult {
  return {
    schemaVersion: TOOL_RUNTIME_SCHEMA_VERSION,
    callId,
    toolName: "read_file",
    status: "succeeded",
    truncated: false,
    redacted: false,
    durationMs: 1,
    bytesProduced: output.length,
    warnings: [],
    output,
    audit: {
      callId,
      toolName: "read_file",
      startedAt: "2026-08-16T00:00:00.000Z",
      endedAt: "2026-08-16T00:00:00.001Z",
      status: "succeeded",
      inputPreview: "read_file",
      outputPreview: output,
      bytesProduced: output.length,
      durationMs: 1,
      truncated: false,
      redacted: false,
    },
  };
}

describe("ToolCallCache", () => {
  it("dedups identical read-only tool+args under a new callId", () => {
    const cache = new ToolCallCache();
    const first = result("call_1", "export const n = 1;");
    cache.set("call_1", first);
    cache.setContent("read_file", { path: "src/a.ts" }, first);

    const hit = cache.getByContent("read_file", { path: "src/a.ts" });
    expect(hit?.output).toBe("export const n = 1;");

    const rebased = rebaseToolResult(hit!, "call_2");
    expect(rebased.callId).toBe("call_2");
    expect(rebased.output).toBe("export const n = 1;");
  });

  it("full-wipes content keys when invalidateContent has no paths", () => {
    const cache = new ToolCallCache();
    const first = result("call_1", "old");
    cache.set("call_1", first);
    cache.setContent("read_file", { path: "src/a.ts" }, first);

    expect(cache.invalidateContent()).toBe(1);

    expect(cache.get("call_1")?.output).toBe("old");
    expect(cache.getByContent("read_file", { path: "src/a.ts" })).toBeUndefined();
  });

  it("path-aware invalidation keeps unrelated package reads", () => {
    const cache = new ToolCallCache();
    const source = result("call_src", "formik");
    const target = result("call_tgt", "mui");
    cache.setContent(
      "read_file",
      { path: "packages/formik-form-builder/src/index.ts" },
      source,
    );
    cache.setContent(
      "read_file",
      { path: "packages/mui-builder/src/index.ts" },
      target,
    );

    const removed = cache.invalidateContent([
      "packages/mui-builder/src/index.ts",
    ]);
    expect(removed).toBe(1);
    expect(
      cache.getByContent("read_file", {
        path: "packages/formik-form-builder/src/index.ts",
      })?.output,
    ).toBe("formik");
    expect(
      cache.getByContent("read_file", {
        path: "packages/mui-builder/src/index.ts",
      }),
    ).toBeUndefined();
  });

  it("invalidates parent directory listings when a child file changes", () => {
    const cache = new ToolCallCache();
    const listing = result("call_list", "Button.tsx\nindex.ts");
    cache.setContent(
      "list_directory",
      { path: "packages/mui-builder/src" },
      listing,
    );
    cache.setContent(
      "read_file",
      { path: "packages/formik-form-builder/README.md" },
      result("call_readme", "# formik"),
    );

    expect(
      cache.invalidateContent(["packages/mui-builder/src/Button.tsx"]),
    ).toBe(1);
    expect(
      cache.getByContent("list_directory", {
        path: "packages/mui-builder/src",
      }),
    ).toBeUndefined();
    expect(
      cache.getByContent("read_file", {
        path: "packages/formik-form-builder/README.md",
      })?.output,
    ).toBe("# formik");
  });

  it("conservatively drops entries with empty path metadata", () => {
    const cache = new ToolCallCache();
    cache.setContent("run_readonly_command", { command: "pwd" }, result("c1", "/"));
    expect(cache.invalidateContent(["src/a.ts"])).toBe(1);
  });

  it("stores explicit paths when provided to setContent", () => {
    const cache = new ToolCallCache();
    cache.setContent(
      "read_file",
      { path: "ignored.ts" },
      result("c1", "body"),
      ["packages/mui-builder/src/real.ts"],
    );
    expect(cache.contentPaths()).toEqual([["packages/mui-builder/src/real.ts"]]);
    expect(
      cache.invalidateContent(["packages/mui-builder/src/real.ts"]),
    ).toBe(1);
  });

  it("invalidates multiple overlapping content entries in one pass", () => {
    const cache = new ToolCallCache();
    cache.setContent(
      "read_file",
      { path: "packages/mui-builder/src/a.ts" },
      result("a", "a"),
    );
    cache.setContent(
      "read_file",
      { path: "packages/mui-builder/src/b.ts" },
      result("b", "b"),
    );
    cache.setContent(
      "read_file",
      { path: "packages/formik-form-builder/src/c.ts" },
      result("c", "c"),
    );
    expect(
      cache.invalidateContent([
        "packages/mui-builder/src/a.ts",
        "packages/mui-builder/src/b.ts",
      ]),
    ).toBe(2);
    expect(
      cache.getByContent("read_file", {
        path: "packages/formik-form-builder/src/c.ts",
      })?.output,
    ).toBe("c");
  });

  it("does not invalidate when changed paths are unrelated", () => {
    const cache = new ToolCallCache();
    cache.setContent(
      "read_file",
      { path: "packages/formik-form-builder/src/index.ts" },
      result("src", "formik"),
    );
    expect(
      cache.invalidateContent(["packages/mui-builder/src/index.ts"]),
    ).toBe(0);
    expect(
      cache.getByContent("read_file", {
        path: "packages/formik-form-builder/src/index.ts",
      })?.output,
    ).toBe("formik");
  });
});
