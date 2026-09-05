import { describe, expect, it } from "vitest";

import {
  extractToolContentPaths,
  normalizeRepoPath,
  stripPathRangeSuffix,
  toolContentPathsOverlap,
} from "../extractToolContentPaths";

describe("extractToolContentPaths", () => {
  it("extracts path from read_file args", () => {
    expect(
      extractToolContentPaths("read_file", { path: "./src/a.ts" }),
    ).toEqual(["src/a.ts"]);
  });

  it("extracts paths from read_many_files", () => {
    expect(
      extractToolContentPaths("read_many_files", {
        paths: ["src/a.ts", "src/b.ts", "src/a.ts"],
      }),
    ).toEqual(["src/a.ts", "src/b.ts"]);
  });

  it("extracts directory listings and search roots", () => {
    expect(
      extractToolContentPaths("list_directory", { path: "packages/mui-builder" }),
    ).toEqual(["packages/mui-builder"]);
    expect(
      extractToolContentPaths("search_files", { path: "packages/formik-form-builder" }),
    ).toEqual(["packages/formik-form-builder"]);
  });

  it("extracts apply_patch targets", () => {
    expect(
      extractToolContentPaths("apply_patch", {
        patches: [{ path: "src/a.ts", oldText: "a", newText: "b" }],
      }),
    ).toEqual(["src/a.ts"]);
  });

  it("extracts move_file from/to paths", () => {
    expect(
      extractToolContentPaths("move_file", {
        from: "src/old.ts",
        to: "src/new.ts",
      }),
    ).toEqual(["src/old.ts", "src/new.ts"]);
  });

  it("ignores blank path strings", () => {
    expect(
      extractToolContentPaths("read_file", { path: "   ", paths: ["", "src/a.ts"] }),
    ).toEqual(["src/a.ts"]);
  });

  it("returns empty for non-object args", () => {
    expect(extractToolContentPaths("read_file", null)).toEqual([]);
    expect(extractToolContentPaths("read_file", "x")).toEqual([]);
  });
});

describe("stripPathRangeSuffix", () => {
  it("strips line ranges from exploration locators", () => {
    expect(stripPathRangeSuffix("src/a.ts:12-40")).toBe("src/a.ts");
    expect(stripPathRangeSuffix("src/a.ts:12")).toBe("src/a.ts");
  });

  it("preserves bare paths", () => {
    expect(stripPathRangeSuffix("src/a.ts")).toBe("src/a.ts");
  });
});

describe("toolContentPathsOverlap", () => {
  it("matches exact paths", () => {
    expect(
      toolContentPathsOverlap(["src/a.ts"], ["src/a.ts"]),
    ).toBe(true);
  });

  it("matches parent directory listings against changed files", () => {
    expect(
      toolContentPathsOverlap(
        ["packages/mui-builder"],
        ["packages/mui-builder/src/Button.tsx"],
      ),
    ).toBe(true);
  });

  it("does not match unrelated packages", () => {
    expect(
      toolContentPathsOverlap(
        ["packages/formik-form-builder/src/index.ts"],
        ["packages/mui-builder/src/index.ts"],
      ),
    ).toBe(false);
  });

  it("matches ranged locators to bare mutation paths", () => {
    expect(
      toolContentPathsOverlap(["src/a.ts:1-20"], ["src/a.ts"]),
    ).toBe(true);
  });

  it("returns false for empty inputs", () => {
    expect(toolContentPathsOverlap([], ["src/a.ts"])).toBe(false);
    expect(toolContentPathsOverlap(["src/a.ts"], [])).toBe(false);
  });
});

describe("normalizeRepoPath", () => {
  it("normalizes separators and leading ./", () => {
    expect(normalizeRepoPath(" .\\src\\a.ts ")).toBe("src/a.ts");
    expect(normalizeRepoPath("./src/a.ts")).toBe("src/a.ts");
  });
});
