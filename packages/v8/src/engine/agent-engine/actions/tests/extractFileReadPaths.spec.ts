import { describe, expect, it } from "vitest";

import { extractFileReadPaths } from "../extractFileReadPaths";

describe("extractFileReadPaths", () => {
  it("collects read_file and read_many_files paths", () => {
    expect(
      extractFileReadPaths("read_file", { path: "src/hooks/useFormBuilder.ts" }),
    ).toEqual(["src/hooks/useFormBuilder.ts"]);
    expect(
      extractFileReadPaths("read_many_files", {
        paths: ["a.ts", "b.ts", ""],
      }),
    ).toEqual(["a.ts", "b.ts"]);
  });

  it("includes line ranges so continuation reads count as new coverage", () => {
    expect(
      extractFileReadPaths("read_file", {
        path: "src/a.ts",
        startLine: 181,
      }),
    ).toEqual(["src/a.ts:181"]);
    expect(
      extractFileReadPaths("read_file", {
        path: "src/a.ts",
        startLine: 10,
        endLine: 20,
      }),
    ).toEqual(["src/a.ts:10-20"]);
  });

  it("ignores mutation and search tools", () => {
    expect(
      extractFileReadPaths("apply_patch", {
        patches: [{ path: "a.ts", oldText: "", newText: "x" }],
      }),
    ).toBeUndefined();
    expect(
      extractFileReadPaths("search_files", { path: "src/hooks/useFormBuilder.ts" }),
    ).toBeUndefined();
  });
});
