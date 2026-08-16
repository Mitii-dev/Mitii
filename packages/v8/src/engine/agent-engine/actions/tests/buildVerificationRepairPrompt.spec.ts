import { describe, expect, it } from "vitest";

import { VERIFICATION_SCHEMA_VERSION } from "../../../../modules/verification";
import { buildVerificationRepairPrompt } from "../buildVerificationRepairPrompt";

describe("buildVerificationRepairPrompt", () => {
  it("asks for one compact repair pass with the top remaining errors", () => {
    const prompt = buildVerificationRepairPrompt({
      verification: {
        schemaVersion: VERIFICATION_SCHEMA_VERSION,
        status: "verification_failed",
        stateToken: "tok",
        affectedProjectIds: [],
        checks: [],
        diagnostics: [
          {
            path: "src/a.ts",
            severity: "error",
            message: "Expected x to be 3.",
            startLine: 1,
          },
        ],
        diff: {
          reviewed: true,
          staleStateRisk: false,
          summary: "reviewed",
          changedPaths: ["src/a.ts"],
        },
        warnings: [],
        reasonCodes: ["checks_failed"],
        durationMs: 1,
      },
      comparison: {
        beforeErrorCount: 0,
        afterErrorCount: 1,
        clearedErrorCount: 0,
        newErrorCount: 1,
        remainingErrorCount: 0,
        failedCheckIdsBefore: [],
        failedCheckIdsAfter: ["typecheck"],
        reasonCodes: ["new_errors_introduced"],
      },
      changedFiles: ["src/a.ts"],
    });

    expect(prompt).toContain("one repair attempt");
    expect(prompt).toContain("src/a.ts:1");
    expect(prompt).toContain("Expected x to be 3.");
    expect(prompt).not.toContain("full dump");
  });
});
