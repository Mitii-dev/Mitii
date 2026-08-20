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

    expect(prompt).toContain("Call apply_patch now");
    expect(prompt).toContain("Group remaining errors by code");
    expect(prompt).not.toContain("one repair attempt");
    expect(prompt).toContain("src/a.ts:1");
    expect(prompt).toContain("Expected x to be 3.");
    expect(prompt).not.toContain("full dump");
  });

  it("embeds apply_patch batch caps from the mutation budget", () => {
    const prompt = buildVerificationRepairPrompt({
      changedFiles: ["src/a.ts"],
      mutationBudget: {
        maxPatchesPerCall: 8,
        maxUniqueFilesPerCall: 5,
        preferredBatchSize: 3,
      },
    });
    expect(prompt).toContain("8 patches");
    expect(prompt).toContain("5 unique files");
    expect(prompt).toContain("3 files");
  });

  it("prefers the active batch working set over a wide diagnostic dump", () => {
    const prompt = buildVerificationRepairPrompt({
      changedFiles: ["src/a.ts"],
      activeBatch: {
        title: "Change: Fix TS2322 in src/a.ts",
        write: ["src/a.ts"],
        mustRead: ["src/types.ts"],
        affected: ["src/a.test.ts"],
      },
      verification: {
        schemaVersion: VERIFICATION_SCHEMA_VERSION,
        status: "verification_failed",
        stateToken: "tok",
        affectedProjectIds: [],
        checks: [],
        diagnostics: Array.from({ length: 20 }, (_, index) => ({
          path: `src/file${index}.ts`,
          severity: "error" as const,
          message: `Error ${index}`,
        })),
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
    });
    expect(prompt).toContain("Active batch");
    expect(prompt).toContain("write: src/a.ts");
    expect(prompt).toContain("need: src/types.ts");
    expect(prompt).toContain("Fix only this batch this turn");
    expect(prompt).not.toContain("src/file19.ts");
  });
});
