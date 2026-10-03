import { describe, expect, it } from "vitest";

import {
  canonicalizeMutationPath,
  normalizeCiWorkflowPath,
} from "./canonicalizeMutationPath";

describe("canonicalizeMutationPath", () => {
  it("strips @ mentions and normalizes slashes", () => {
    expect(canonicalizeMutationPath("@packages/v8/src/a.ts")).toBe(
      "packages/v8/src/a.ts",
    );
    expect(canonicalizeMutationPath("src\\foo\\bar.ts")).toBe("src/foo/bar.ts");
  });

  it("rewrites github/ to .github/", () => {
    expect(canonicalizeMutationPath("github/workflows/ci.yml")).toBe(
      ".github/workflows/ci.yml",
    );
    expect(normalizeCiWorkflowPath("github/CODEOWNERS")).toBe(
      ".github/CODEOWNERS",
    );
  });
});
