import { describe, expect, it } from "vitest";

import {
  buildVerificationRecord,
  buildVerificationUserSummary,
} from "../..";
import type { RepoBuildState } from "../..";

function buildState(
  phase: "before" | "after",
  errorPaths: readonly string[],
): RepoBuildState {
  return {
    schemaVersion: 1,
    capturedAt: "2026-08-15T12:00:00.000Z",
    phase,
    scope: {
      workspaceRoot: "/repo",
      folderPrefixes: ["src"],
      projectIds: ["web"],
      changeScope: "localized",
    },
    checks: [],
    diagnostics: errorPaths.map((path) => ({
      path,
      severity: "error" as const,
      message: `error in ${path}`,
    })),
    summary: {
      errorCount: errorPaths.length,
      warningCount: 0,
      failedCheckIds: [],
    },
    reasonCodes: [],
  };
}

describe("buildVerificationUserSummary", () => {
  it("offers pre-existing leftovers as optional when there are no new regressions", () => {
    const record = buildVerificationRecord({
      runId: "run_1",
      requestId: "req_1",
      status: "incomplete",
      before: buildState("before", ["src/a.ts", "src/c.ts"]),
      after: buildState("after", ["src/a.ts", "src/c.ts"]),
      // Ask touched a.ts; c.ts remains as optional pre-existing outside the edit.
      changedFiles: ["src/a.ts"],
    });
    const summary = buildVerificationUserSummary(record);
    expect(summary).toContain("no new regressions");
    expect(summary).toContain("pre-existing");
    expect(summary).toContain("optional");
    expect(summary).toContain("fix the remaining verification errors");
    expect(summary).not.toContain("Verification did not go clean");
  });

  it("does not claim edits were kept when no workspace files changed", () => {
    const record = buildVerificationRecord({
      runId: "run_1_blocked",
      requestId: "req_1_blocked",
      status: "incomplete",
      before: buildState("before", ["src/a.ts", "src/c.ts"]),
      after: buildState("after", ["src/a.ts", "src/c.ts"]),
      changedFiles: [],
    });
    const summary = buildVerificationUserSummary(record);
    expect(summary).toContain("No workspace edits were applied");
    expect(summary).not.toContain("edits were kept");
    expect(summary).not.toContain("no new regressions from this change");
  });

  it("lists new regressions when this change introduced errors", () => {
    const record = buildVerificationRecord({
      runId: "run_1b",
      requestId: "req_1b",
      status: "incomplete",
      before: buildState("before", ["src/a.ts"]),
      after: buildState("after", ["src/b.ts"]),
      changedFiles: ["src/b.ts"],
    });
    const summary = buildVerificationUserSummary(record);
    expect(summary).toContain("new issues from this change");
    expect(summary).toContain("New (this change): 1");
    expect(summary).toContain("src/b.ts");
    expect(summary).toContain("fix the remaining verification errors");
  });

  it("reports a clean pass", () => {
    const record = buildVerificationRecord({
      runId: "run_2",
      requestId: "req_2",
      status: "passed",
      before: buildState("before", ["src/a.ts"]),
      after: buildState("after", []),
      changedFiles: ["src/a.ts"],
    });
    const summary = buildVerificationUserSummary(record);
    expect(summary).toContain("Verification passed");
    expect(summary).toContain("Cleared 1");
    expect(summary).toContain("edits were kept");
  });
});
