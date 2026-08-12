import { describe, expect, it } from "vitest";

import {
  collectRepositoryContextGraphAnchors,
  deriveContextSelectionBudget,
  REPOSITORY_CONTEXT_RETRIEVAL_POLICY,
} from "../policy";

describe("deriveContextSelectionBudget", () => {
  it("floors at default selection limits for small windows", () => {
    const budget = deriveContextSelectionBudget(8_192);
    expect(budget.maximumTokens).toBe(12_000);
    expect(budget.maximumItems).toBe(24);
    expect(budget.maximumFiles).toBe(16);
  });

  it("scales selection budget with large context windows", () => {
    const budget = deriveContextSelectionBudget(252_000);
    expect(budget.maximumTokens).toBe(63_000);
    expect(budget.maximumItems).toBe(126);
    expect(budget.maximumFiles).toBe(84);
  });
});

describe("collectRepositoryContextGraphAnchors", () => {
  it("dedupes current, open, and git-dirty files without using them as filters", () => {
    expect(
      collectRepositoryContextGraphAnchors({
        currentFile: { relativePath: "src/auth.ts" },
        openFiles: [
          { relativePath: "src/auth.ts" },
          { relativePath: "src/token.ts" },
        ],
        gitDiffFiles: [{ relativePath: "src/token.ts" }],
      }),
    ).toEqual(["src/auth.ts", "src/token.ts"]);
  });

  it("caps graph file anchors", () => {
    const gitDiffFiles = Array.from(
      { length: REPOSITORY_CONTEXT_RETRIEVAL_POLICY.maximumGraphFileAnchors + 5 },
      (_, index) => ({ relativePath: `src/file-${index}.ts` }),
    );
    expect(collectRepositoryContextGraphAnchors({ gitDiffFiles })).toHaveLength(
      REPOSITORY_CONTEXT_RETRIEVAL_POLICY.maximumGraphFileAnchors,
    );
  });
});
