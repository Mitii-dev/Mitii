import { describe, expect, it } from "vitest";

import {
  flattenPorcelainFiles,
  gitStatusPathsFromPorcelain,
  parseAheadBehind,
  parseGitPorcelain,
  porcelainToReviewEntries,
} from "./porcelain";

describe("parseGitPorcelain", () => {
  it("splits staged, changes, and untracked (LF)", () => {
    const raw = [
      "## main...origin/main [ahead 1, behind 2]",
      "M  staged.ts",
      " M dirty.ts",
      "MM both.ts",
      "?? new.ts",
      "R  old.ts -> renamed.ts",
    ].join("\n");

    const parsed = parseGitPorcelain(raw);
    expect(parsed.branch).toBe("main");
    expect(parsed.ahead).toBe(1);
    expect(parsed.behind).toBe(2);
    expect(parsed.staged.map((f) => f.path)).toEqual([
      "both.ts",
      "renamed.ts",
      "staged.ts",
    ]);
    expect(parsed.staged.find((f) => f.path === "renamed.ts")?.renameFrom).toBe(
      "old.ts",
    );
    expect(parsed.changes.map((f) => f.path)).toEqual(["both.ts", "dirty.ts"]);
    expect(parsed.untracked.map((f) => f.path)).toEqual(["new.ts"]);
    expect(flattenPorcelainFiles(parsed).map((f) => f.path)).toEqual([
      "both.ts",
      "renamed.ts",
      "staged.ts",
      "dirty.ts",
      "new.ts",
    ]);
  });

  it("parses NUL -z output (rename = new then old)", () => {
    const raw = [
      "## main",
      " M dirty.ts",
      "R  renamed.ts",
      "old.ts",
      "?? new.ts",
      "?? nested/file.ts",
      "",
    ].join("\0");

    const parsed = parseGitPorcelain(raw);
    expect(parsed.branch).toBe("main");
    expect(parsed.staged).toEqual([
      {
        path: "renamed.ts",
        status: "R",
        group: "staged",
        renameFrom: "old.ts",
      },
    ]);
    expect(parsed.changes.map((f) => f.path)).toEqual(["dirty.ts"]);
    expect(parsed.untracked.map((f) => f.path)).toEqual([
      "nested/file.ts",
      "new.ts",
    ]);
  });

  it("maps to GitPort status paths", () => {
    const raw = "## main\nM  a.ts\n M b.ts\n?? c.ts\n";
    const paths = gitStatusPathsFromPorcelain(parseGitPorcelain(raw), raw);
    expect(paths.branch).toBe("main");
    expect(paths.staged).toEqual(["a.ts"]);
    expect(paths.unstaged).toEqual(["b.ts"]);
    expect(paths.untracked).toEqual(["c.ts"]);
  });

  it("maps to review entries", () => {
    const raw = [" M a.ts", "?? b.ts", "D  c.ts", ""].join("\0");
    expect(porcelainToReviewEntries(parseGitPorcelain(raw))).toEqual([
      { path: "b.ts", status: "added", untracked: true },
      { path: "c.ts", status: "deleted" },
      { path: "a.ts", status: "modified" },
    ]);
  });

  it("parseAheadBehind handles missing trailer", () => {
    expect(parseAheadBehind("## feature")).toEqual({});
  });
});
