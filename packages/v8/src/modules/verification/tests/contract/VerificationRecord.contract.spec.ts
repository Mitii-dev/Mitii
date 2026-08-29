import { describe, expect, it } from "vitest";

import {
  VERIFICATION_RECORD_SCHEMA_VERSION,
  buildVerificationRecord,
  verificationRecordSchema,
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

describe("VerificationRecord contract", () => {
  it("accepts a valid incomplete record with retry handle", () => {
    const record = buildVerificationRecord({
      runId: "run_1",
      requestId: "req_1",
      workspaceId: "ws_1",
      status: "incomplete",
      before: buildState("before", ["src/a.ts"]),
      after: buildState("after", ["src/a.ts", "src/b.ts"]),
      changedFiles: ["src/b.ts"],
    });

    const parsed = verificationRecordSchema.safeParse(record);
    expect(parsed.success).toBe(true);
    expect(record.schemaVersion).toBe(VERIFICATION_RECORD_SCHEMA_VERSION);
    expect(record.status).toBe("incomplete");
    expect(record.retry).toEqual({
      kind: "fix_remaining",
      recordId: "run_1",
    });
    expect(record.comparison?.newErrorCount).toBe(1);
    expect(record.reasonCodes).toContain("retry_available");
  });

  it("rejects an invalid record", () => {
    const parsed = verificationRecordSchema.safeParse({
      schemaVersion: 1,
      recordId: "run_1",
    });
    expect(parsed.success).toBe(false);
  });

  it("omits retry when the record passed", () => {
    const record = buildVerificationRecord({
      runId: "run_2",
      requestId: "req_2",
      status: "passed",
      before: buildState("before", ["src/a.ts"]),
      after: buildState("after", []),
    });
    expect(record.retry).toBeUndefined();
    expect(record.reasonCodes).toContain("record_passed");
  });
});
