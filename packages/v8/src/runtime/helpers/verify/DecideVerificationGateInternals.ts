import {
  assessTaskRelevantEvidence,
  hasBehaviorDefect,
  requiresBehaviorEvidence,
  type RepoBuildStateComparison,
  type VerificationResult,
} from "../../../modules/verification";

import {
  hasFailedProjectLocalCompile,
  normalizeMinimumEvidence,
} from "./IsUserGoalComplete";

export function hasInScopeActionableRepairTarget(params: {
  verification: VerificationResult;
  comparison?: RepoBuildStateComparison;
  askScopePaths?: readonly string[];
  changedFiles?: readonly string[];
  minimumEvidence?: readonly string[];
}): boolean {
  if (params.comparison && params.comparison.newErrorCount > 0) {
    return true;
  }
  const assessment = assessTaskRelevantEvidence({
    verification: {
      required: true,
      minimumEvidence: normalizeMinimumEvidence(params.minimumEvidence),
      allowUnavailable: true,
      onFailure: "report",
    },
    checks: params.verification.checks,
    diagnostics: params.verification.diagnostics,
    changedFiles: params.changedFiles,
    askScopePaths: params.askScopePaths,
  });
  if (assessment.residualKind === "ask_scoped_defect") {
    return true;
  }
  if (hasFailedProjectLocalCompile(params.verification.checks)) {
    return true;
  }
  // Behavior-implied asks (HTTP/routes/scripts/tests): a failing suite is a
  // repairable defect even without parseable in-scope diagnostics.
  if (
    requiresBehaviorEvidence(normalizeMinimumEvidence(params.minimumEvidence)) &&
    hasBehaviorDefect(params.verification.checks)
  ) {
    return true;
  }
  if (assessment.shouldAccept) {
    return false;
  }
  // Assessor rejected, but compare shows no NEW and failures are not
  // project-local compile / ask-scoped — treat as leftover fixture noise.
  if (params.comparison && params.comparison.newErrorCount === 0) {
    return false;
  }
  return true;
}

export function behaviorDefectMessage(params: {
  verification: VerificationResult;
  minimumEvidence?: readonly string[];
}): string | undefined {
  if (
    !requiresBehaviorEvidence(normalizeMinimumEvidence(params.minimumEvidence)) ||
    !hasBehaviorDefect(params.verification.checks)
  ) {
    return undefined;
  }
  return "A test/smoke check for the requested behavior failed after the change; compile evidence alone does not prove it.";
}

export function diagnosticErrorMessage(
  comparison: RepoBuildStateComparison | undefined,
): string {
  if (!comparison) {
    return "Verification is incomplete and still reports actionable failures.";
  }
  const newErrors =
    comparison.newErrorCount > 0
      ? `, including ${comparison.newErrorCount} new in-scope error(s)`
      : "";
  return `Verification is incomplete and diagnostics still report ${comparison.afterErrorCount} in-scope error(s)${newErrors}.`;
}

/**
 * True when Verification's task-relevant evidence assessor says accept, or
 * when the actionable before→after compare shows no new regressions.
 *
 * Mental model:
 * - Ask done + no NEW in-scope errors → soft-accept leftovers
 * - Ask-scoped defects / failed project-local compile → not complete
 * - User may still opt in later via "fix remaining verification errors"
 *
 * Residual classification (harness / phantom / workspace-root) is owned by
 * `@mitii/v8` Verification — this gate only orchestrates accept vs repair.
 */
export function isSoftUnavailableBlock(
  verification: VerificationResult,
  allowUnavailable: boolean,
): boolean {
  const reasonCodes = new Set(verification.reasonCodes);
  const hasHardBlocker =
    reasonCodes.has("state_unavailable") ||
    reasonCodes.has("grant_insufficient") ||
    reasonCodes.has("cancelled");
  if (hasHardBlocker) {
    return false;
  }

  const hasUnavailableReason =
    reasonCodes.has("checks_unavailable") ||
    reasonCodes.has("no_applicable_checks") ||
    reasonCodes.has("missing_tool_degraded");
  if (!hasUnavailableReason) {
    return false;
  }

  const hasDefectiveCheck = verification.checks.some(
    (check) =>
      check.outcome === "failed" ||
      check.outcome === "timed_out" ||
      check.outcome === "cancelled",
  );
  if (hasDefectiveCheck) {
    return false;
  }

  const hasPassedEvidence = verification.checks.some(
    (check) => check.outcome === "passed",
  );
  return hasPassedEvidence || allowUnavailable;
}
