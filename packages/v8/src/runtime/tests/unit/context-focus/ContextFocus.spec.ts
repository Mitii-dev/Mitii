import { describe, expect, it } from "vitest";

import {
  deriveContextFocusFromUnderstanding,
  mergeContextFocusWithPriorPathHints,
} from "../../../helpers/context-focus";

function understandingWithTargets(
  targets: Array<{ kind: "file" | "folder"; value: string; explicit: boolean }>,
) {
  return {
    taskAnalysis: {
      targets,
    },
  } as Parameters<typeof deriveContextFocusFromUnderstanding>[0];
}

describe("mergeContextFocusWithPriorPathHints", () => {
  it("pins prior Ask paths as required references", () => {
    const focus = deriveContextFocusFromUnderstanding(
      understandingWithTargets([]),
    );
    const merged = mergeContextFocusWithPriorPathHints(focus, [
      "packages/runner/src/verifiers.js",
      "packages/runner/src/http-check.js",
    ]);
    expect(merged.filePaths).toEqual(
      expect.arrayContaining([
        "packages/runner/src/verifiers.js",
        "packages/runner/src/http-check.js",
      ]),
    );
    expect(merged.references?.explicitFiles.map((f) => f.relativePath)).toEqual(
      expect.arrayContaining([
        "packages/runner/src/verifiers.js",
        "packages/runner/src/http-check.js",
      ]),
    );
  });

  it("does not narrow folder-scoped focus via filePaths filter", () => {
    const focus = deriveContextFocusFromUnderstanding(
      understandingWithTargets([
        { kind: "folder", value: "packages/runner", explicit: true },
      ]),
    );
    const merged = mergeContextFocusWithPriorPathHints(focus, [
      "packages/runner/src/verifiers.js",
    ]);
    expect(merged.folderPrefix).toBe("packages/runner");
    expect(merged.filePaths).toEqual([]);
    expect(merged.references?.explicitFiles).toEqual([
      { relativePath: "packages/runner/src/verifiers.js" },
    ]);
  });
});
