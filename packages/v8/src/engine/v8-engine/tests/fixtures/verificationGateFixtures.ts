import type {
  RepoBuildStateComparison,
  VerificationResult,
} from "../../../../modules/verification";

export function baseVerification(
  overrides: Partial<VerificationResult> &
    Pick<VerificationResult, "status" | "checks">,
): VerificationResult {
  return {
    schemaVersion: 1,
    stateToken: "tok",
    affectedProjectIds: [],
    diagnostics: [],
    diff: {
      reviewed: true,
      staleStateRisk: false,
      summary: "ok",
      changedPaths: ["packages/host/src/x.ts"],
    },
    warnings: [],
    reasonCodes: ["checks_failed"],
    durationMs: 10,
    ...overrides,
  };
}

export function comparison(
  overrides: Partial<RepoBuildStateComparison> = {},
): RepoBuildStateComparison {
  return {
    beforeErrorCount: 0,
    afterErrorCount: 0,
    clearedErrorCount: 0,
    newErrorCount: 0,
    remainingErrorCount: 0,
    failedCheckIdsBefore: [],
    failedCheckIdsAfter: [],
    reasonCodes: [],
    ...overrides,
  };
}
