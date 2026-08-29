import { describe, expect, it } from "vitest";

import {
  WINDOW_BUDGET_SCHEMA_VERSION,
  deriveWindowPolicy,
} from "../../window-budget";
import {
  collectRepositoryContextGraphAnchors,
  deriveContextSelectionBudget,
  pathMatchesFolderPrefix,
  restrictContextReferencesToFolderPrefix,
  REPOSITORY_CONTEXT_RETRIEVAL_POLICY,
} from "../policy";

describe("deriveContextSelectionBudget", () => {
  it("uses the window-derived repository slice instead of a 12k floor", () => {
    const derived = deriveWindowPolicy({
      schemaVersion: WINDOW_BUDGET_SCHEMA_VERSION,
      contextWindowTokens: 8_192,
    });
    const budget = deriveContextSelectionBudget(8_192);
    expect(budget.maximumTokens).toBe(derived.sections.repositoryTokens);
    expect(budget.maximumTokens).toBeLessThan(8_192);
    expect(budget.maximumTokens).toBeLessThan(12_000);
    expect(budget.maximumItems).toBeGreaterThan(0);
    expect(budget.maximumFiles).toBeGreaterThan(0);
  });

  it("scales selection budget with large context windows", () => {
    const derived = deriveWindowPolicy({
      schemaVersion: WINDOW_BUDGET_SCHEMA_VERSION,
      contextWindowTokens: 252_000,
    });
    const budget = deriveContextSelectionBudget(252_000);
    expect(budget.maximumTokens).toBe(derived.sections.repositoryTokens);
    expect(budget.maximumTokens).toBeGreaterThan(8_192);
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

describe("restrictContextReferencesToFolderPrefix", () => {
  it("keeps only editor and git priors inside the mentioned folder", () => {
    expect(
      restrictContextReferencesToFolderPrefix(
        {
          currentFile: { relativePath: ".gitignore" },
          openFiles: [
            { relativePath: "apps/docs/readme.md" },
            { relativePath: "packages/demo/src/used.ts" },
          ],
          gitDiffFiles: [{ relativePath: "packages/demo/src/other.ts" }],
        },
        "packages/demo",
      ),
    ).toEqual({
      openFiles: [{ relativePath: "packages/demo/src/used.ts" }],
      gitDiffFiles: [{ relativePath: "packages/demo/src/other.ts" }],
    });
  });

  it("keeps explicit file filters even when they sit outside the folder", () => {
    expect(
      restrictContextReferencesToFolderPrefix(
        {
          gitDiffFiles: [{ relativePath: "apps/docs/readme.md" }],
          explicitFiles: [{ relativePath: "apps/docs/readme.md" }],
        },
        "packages/demo",
        ["apps/docs/readme.md"],
      ),
    ).toEqual({
      gitDiffFiles: [{ relativePath: "apps/docs/readme.md" }],
      explicitFiles: [{ relativePath: "apps/docs/readme.md" }],
    });
  });
});

describe("pathMatchesFolderPrefix", () => {
  it("matches the folder itself and descendants only", () => {
    expect(pathMatchesFolderPrefix("packages/demo", "packages/demo")).toBe(true);
    expect(
      pathMatchesFolderPrefix("packages/demo/src/used.ts", "packages/demo"),
    ).toBe(true);
    expect(pathMatchesFolderPrefix("packages/other/src/used.ts", "packages/demo")).toBe(
      false,
    );
  });
});
