import { describe, expect, it } from "vitest";

import { buildForcedMutationNudgeMessage } from "../buildForcedMutationNudgeMessage";

describe("buildForcedMutationNudgeMessage", () => {
  it("requires apply_patch and lists preflight diagnostics", () => {
    const message = buildForcedMutationNudgeMessage({
      totalErrorCount: 2,
      pathScopes: ["."],
      diagnostics: [
        {
          path: "src/a.ts",
          severity: "error",
          message: "Cannot find name 'Foo'",
          startLine: 10,
          source: "tsc",
          code: "TS2304",
        },
      ],
      requestedTools: ["glob_files", "search_files"],
    });
    expect(message).toContain("MUTATION REQUIRED NOW");
    expect(message).toContain("apply_patch");
    expect(message).toContain("src/a.ts");
    expect(message).toContain("TS2304");
    expect(message).toContain("glob_files");
  });

  it("omits preflight errors the user request never names", () => {
    const message = buildForcedMutationNudgeMessage({
      totalErrorCount: 2,
      pathScopes: ["."],
      userPrompt: [
        "FAIL apps/vscode/tests/liveTokenBudgetPreview.test.ts",
        "expected 8 to be 12",
      ].join("\n"),
      diagnostics: [
        {
          path: "apps/desktop/src/renderer/styles.css",
          severity: "error",
          message: "padding: 4px; is not valid here",
          startLine: 2275,
          source: "tsc",
        },
      ],
    });
    expect(message).toContain("apply_patch");
    expect(message).toContain("read_file");
    expect(message).not.toContain("styles.css");
    expect(message).not.toContain("padding: 4px");
    expect(message).not.toContain("Preflight verification already captured");
    expect(message).not.toContain("one-line Blocker");
  });

  it("calls out missing paths for create-via-patch", () => {
    const message = buildForcedMutationNudgeMessage({
      missingPath: "test/Desktop/selectors/Header.selectors.ts",
      diagnostics: [],
      totalErrorCount: 0,
    });
    expect(message).toContain("Header.selectors.ts");
    expect(message).toContain("does not exist");
    expect(message).toContain("apply_patch");
  });
});
