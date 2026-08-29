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
  it("reports new remaining and cleared counts without inventing paths", () => {
    const record = buildVerificationRecord({
      runId: "run_1",
      requestId: "req_1",
      status: "incomplete",
      before: buildState("before", ["src/a.ts"]),
      after: buildState("after", ["src/b.ts"]),
    });
    const summary = buildVerificationUserSummary(record);
    expect(summary).toContain("kept the edits");
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
    });
    const summary = buildVerificationUserSummary(record);
    expect(summary).toContain("Verification passed");
    expect(summary).toContain("Cleared 1");
  });
});
