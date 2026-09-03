import { describe, expect, it } from "vitest";

import {
  isFileContextRelevant,
  isInternalAgentPath,
  scoreFileContextRelevance,
} from "../isFileContextRelevant";
import { collectUnderstandingCandidatePaths } from "../collectUnderstandingCandidatePaths";

describe("isFileContextRelevant", () => {
  it("matches basename and CamelCase stem overlap", () => {
    expect(
      isFileContextRelevant(
        "Fix Desktop headless Chrome support",
        "test/shared/session/Desktop.ts",
      ),
    ).toBe(true);
    expect(
      isFileContextRelevant(
        "Clean up BillPage selectors",
        "test/Desktop/pages/BillPage.ts",
      ),
    ).toBe(true);
  });

  it("rejects internal agent paths", () => {
    expect(isInternalAgentPath("node_modules/pkg/index.js")).toBe(true);
    expect(
      isFileContextRelevant("fix index", "node_modules/pkg/index.js"),
    ).toBe(false);
  });

  it("scores explicit path mentions higher than stem-only", () => {
    const message = "Edit test/shared/session/Desktop.ts please";
    expect(
      scoreFileContextRelevance(message, "test/shared/session/Desktop.ts"),
    ).toBeGreaterThan(
      scoreFileContextRelevance(message, "test/Desktop/pages/BillPage.ts"),
    );
  });
});

describe("collectUnderstandingCandidatePaths", () => {
  it("drops internal paths and sorts message-relevant first", () => {
    const paths = collectUnderstandingCandidatePaths({
      dirtyPaths: [
        "node_modules/x/index.js",
        "src/unrelated.ts",
        "test/shared/session/Desktop.ts",
      ],
      userMessage: "Fix Desktop headless support",
    });

    expect(paths).toEqual([
      "test/shared/session/Desktop.ts",
      "src/unrelated.ts",
    ]);
  });

  it("keeps artifact paths even when not mentioned", () => {
    const paths = collectUnderstandingCandidatePaths({
      referencedArtifacts: [
        { path: "package.json", kind: "file", name: "package.json" },
      ],
      userMessage: "Fix Desktop.ts",
    });
    expect(paths).toContain("package.json");
  });
});
