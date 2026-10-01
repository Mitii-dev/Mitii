import { describe, expect, it } from "vitest";

import { syntaxCandidatesForChangedFiles } from "./syntaxCandidates";

describe("syntaxCandidatesForChangedFiles", () => {
  it("emits python py_compile for changed .py files", () => {
    const candidates = syntaxCandidatesForChangedFiles({
      projectId: "py",
      languageId: "python",
      projectRoot: ".",
      changedFiles: ["app.py", "lib/util.py", "README.md"],
    });
    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.kind).toBe("syntax");
    expect(candidates[0]?.argv).toEqual([
      "python3",
      "-m",
      "py_compile",
      "app.py",
      "lib/util.py",
    ]);
  });

  it("emits node --check only for JS files, not TypeScript", () => {
    const candidates = syntaxCandidatesForChangedFiles({
      projectId: "web",
      languageId: "typescript",
      projectRoot: "apps/vscode",
      changedFiles: [
        "apps/vscode/src/a.ts",
        "apps/vscode/scripts/helper.js",
        "packages/v8/src/x.js",
      ],
    });
    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.argv).toEqual([
      "node",
      "--check",
      "apps/vscode/scripts/helper.js",
    ]);
  });

  it("emits bash -n for changed shell files", () => {
    const candidates = syntaxCandidatesForChangedFiles({
      projectId: "scripts",
      languageId: "shell",
      projectRoot: ".",
      changedFiles: ["scripts/run.sh"],
    });
    expect(candidates.map((c) => c.argv)).toEqual([
      ["bash", "-n", "scripts/run.sh"],
    ]);
  });
});
