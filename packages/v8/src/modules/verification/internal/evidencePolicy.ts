import type { VerificationCheckKind, VerificationCheckResult } from "../contracts";

/**
 * Decision Policy evidence kinds → check kinds that can satisfy them.
 * Shared by proportional selection and completion recommendation.
 */
export const EVIDENCE_TO_CHECK: Readonly<
  Record<string, readonly VerificationCheckKind[]>
> = {
  diagnostics: ["diagnostics", "syntax"],
  typecheck: ["typecheck"],
  lint: ["lint", "format"],
  tests: ["test", "build", "typecheck"],
  build: ["build"],
  diff_review: ["diff_review"],
};

export interface EvidenceCoverageAssessment {
  /** Checks that were not skipped (passed/failed/unavailable/timed_out/cancelled). */
  runnable: readonly VerificationCheckResult[];
  passed: readonly VerificationCheckResult[];
  unavailable: readonly VerificationCheckResult[];
  hasFailed: boolean;
  hasTimedOut: boolean;
  hasCancelled: boolean;
  requiredCovered: boolean;
  missingEvidence: readonly string[];
  passedKinds: ReadonlySet<VerificationCheckKind>;
}

/**
 * Assess what evidence the executed checks actually provide versus what
 * Decision Policy required. Discovery gaps (no script/tool) show up as
 * missing evidence, not as failures.
 */
export function assessEvidenceCoverage(params: {
  minimumEvidence: readonly string[];
  checks: readonly VerificationCheckResult[];
}): EvidenceCoverageAssessment {
  const runnable = params.checks.filter((check) => check.outcome !== "skipped");
  const passed = runnable.filter((check) => check.outcome === "passed");
  const unavailable = runnable.filter((check) => check.outcome === "unavailable");
  const passedKinds = new Set(passed.map((check) => check.kind));
  const missingEvidence = findMissingEvidence(
    params.minimumEvidence,
    passedKinds,
  );

  return {
    runnable,
    passed,
    unavailable,
    hasFailed: runnable.some((check) => check.outcome === "failed"),
    hasTimedOut: runnable.some((check) => check.outcome === "timed_out"),
    hasCancelled: runnable.some((check) => check.outcome === "cancelled"),
    requiredCovered: missingEvidence.length === 0,
    missingEvidence,
    passedKinds,
  };
}

export function checkKindsForEvidence(
  evidence: string,
): readonly VerificationCheckKind[] {
  return EVIDENCE_TO_CHECK[evidence] ?? [];
}

function findMissingEvidence(
  minimumEvidence: readonly string[],
  passedKinds: ReadonlySet<VerificationCheckKind>,
): string[] {
  if (minimumEvidence.length === 0) {
    return passedKinds.size > 0 ? [] : ["any"];
  }
  return minimumEvidence.filter((evidence) => {
    const kinds = checkKindsForEvidence(evidence);
    return !kinds.some((kind) => passedKinds.has(kind));
  });
}
