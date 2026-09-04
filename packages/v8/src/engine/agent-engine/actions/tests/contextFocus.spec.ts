import { describe, expect, it } from "vitest";

import { repositoryContextPipelineInputSchema } from "../../../../modules/repository-context/contracts/schema";
import type { RequestUnderstandingResult } from "../../../../modules/request-understanding";
import {
  deriveContextFocusFromUnderstanding,
  toCanonicalWorkspaceRelativePath,
} from "../contextFocus";

function understandingWithTargets(
  targets: RequestUnderstandingResult["taskAnalysis"]["targets"],
): RequestUnderstandingResult {
  return {
    taskAnalysis: { targets },
  } as RequestUnderstandingResult;
}

describe("toCanonicalWorkspaceRelativePath", () => {
  it("strips ./ and @ prefixes that classifiers copy from diagnostics", () => {
    expect(
      toCanonicalWorkspaceRelativePath(
        "./test/Desktop/pages/NavigationPage.ts",
      ),
    ).toBe("test/Desktop/pages/NavigationPage.ts");
    expect(toCanonicalWorkspaceRelativePath("@apps/docs/readme.md")).toBe(
      "apps/docs/readme.md",
    );
    expect(toCanonicalWorkspaceRelativePath("src/./auth/service.ts")).toBe(
      "src/auth/service.ts",
    );
  });

  it("drops absolute and parent-relative paths", () => {
    expect(
      toCanonicalWorkspaceRelativePath(
        "/Users/me/repo/test/Desktop/pages/NavigationPage.ts",
      ),
    ).toBeUndefined();
    expect(toCanonicalWorkspaceRelativePath("../src/a.ts")).toBeUndefined();
    expect(toCanonicalWorkspaceRelativePath("src/../a.ts")).toBeUndefined();
    expect(toCanonicalWorkspaceRelativePath(".")).toBeUndefined();
  });
});

describe("deriveContextFocusFromUnderstanding", () => {
  it("canonicalizes diagnostic-style file targets before context filters", () => {
    const focus = deriveContextFocusFromUnderstanding(
      understandingWithTargets([
        {
          kind: "file",
          value: "./test/Desktop/pages/NavigationPage.ts",
          explicit: true,
        },
      ]),
    );

    expect(focus.filePaths).toEqual([
      "test/Desktop/pages/NavigationPage.ts",
    ]);
    expect(focus.references?.explicitFiles).toEqual([
      { relativePath: "test/Desktop/pages/NavigationPage.ts" },
    ]);

    expect(
      repositoryContextPipelineInputSchema.pick({
        filePaths: true,
        references: true,
      }).safeParse({
        filePaths: focus.filePaths,
        references: focus.references,
      }).success,
    ).toBe(true);
  });

  it("does not pass non-canonical targets through as context filters", () => {
    const focus = deriveContextFocusFromUnderstanding(
      understandingWithTargets([
        { kind: "file", value: "../secret.ts", explicit: true },
        { kind: "folder", value: "/etc", explicit: true },
      ]),
    );

    expect(focus.filePaths).toEqual([]);
    expect(focus.folderPrefix).toBeUndefined();
    expect(focus.references).toBeUndefined();
  });
});
