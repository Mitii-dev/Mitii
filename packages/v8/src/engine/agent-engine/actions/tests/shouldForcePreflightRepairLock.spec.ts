import { describe, expect, it } from "vitest";

import { shouldForcePreflightRepairLock } from "../shouldForcePreflightRepairLock";

describe("shouldForcePreflightRepairLock", () => {
  it("locks execute+write when preflight already captured errors", () => {
    expect(
      shouldForcePreflightRepairLock({
        route: "execute",
        maximumWorkspaceEffect: "write",
        preflightErrorCount: 200,
      }),
    ).toBe(true);
  });

  it("does not lock when there are no preflight errors", () => {
    expect(
      shouldForcePreflightRepairLock({
        route: "execute",
        maximumWorkspaceEffect: "write",
        preflightErrorCount: 0,
      }),
    ).toBe(false);
  });

  it("does not lock read-only or non-execute routes", () => {
    expect(
      shouldForcePreflightRepairLock({
        route: "diagnose",
        maximumWorkspaceEffect: "write",
        preflightErrorCount: 12,
      }),
    ).toBe(false);
    expect(
      shouldForcePreflightRepairLock({
        route: "execute",
        maximumWorkspaceEffect: "read",
        preflightErrorCount: 12,
      }),
    ).toBe(false);
  });

  it("does not lock after files already changed", () => {
    expect(
      shouldForcePreflightRepairLock({
        route: "execute",
        maximumWorkspaceEffect: "write",
        preflightErrorCount: 12,
        changedFilesCount: 1,
      }),
    ).toBe(false);
  });

  it("does not lock a pasted test-failure dump onto unrelated preflight errors", () => {
    const prompt = [
      "Failed Tests 11",
      "FAIL apps/vscode/tests/liveTokenBudgetPreview.test.ts",
      "AssertionError: expected 8 to be 12",
      "❯ apps/vscode/src/sidebar.ts:2490:17",
    ].join("\n");
    expect(
      shouldForcePreflightRepairLock({
        route: "execute",
        maximumWorkspaceEffect: "write",
        preflightErrorCount: 2,
        userPrompt: prompt,
        diagnosticPaths: ["apps/desktop/src/renderer/styles.css"],
      }),
    ).toBe(false);
  });

  it("still locks when the request names a preflight error path", () => {
    expect(
      shouldForcePreflightRepairLock({
        route: "execute",
        maximumWorkspaceEffect: "write",
        preflightErrorCount: 2,
        userPrompt: "Fix the type error in apps/desktop/src/renderer/styles.css",
        diagnosticPaths: ["apps/desktop/src/renderer/styles.css"],
      }),
    ).toBe(true);
  });

  it("still locks a build ask that does not name files", () => {
    expect(
      shouldForcePreflightRepairLock({
        route: "execute",
        maximumWorkspaceEffect: "write",
        preflightErrorCount: 2,
        userPrompt: "Fix the typecheck errors",
        diagnosticPaths: ["apps/desktop/src/renderer/styles.css"],
      }),
    ).toBe(true);
  });
});
