import type { VerificationCheckResult } from "../contracts";
import { isWorkspaceRootCheckId } from "../patterns";

/** Minimum-evidence kind that demands executed test/smoke evidence. */
export const BEHAVIOR_EVIDENCE_KIND = "behavior" as const;

export function requiresBehaviorEvidence(
  minimumEvidence: readonly string[],
): boolean {
  return minimumEvidence.includes(BEHAVIOR_EVIDENCE_KIND);
}

/** Runner output that proves the suite never executed (not a product defect). */
const EMPTY_SUITE_SUMMARY =
  /no test files?|no tests? found|did not (?:run|find) any tests?|no test specified|0 tests?\b|missing script/i;

export function isEmptyTestSuiteSummary(check: VerificationCheckResult): boolean {
  return EMPTY_SUITE_SUMMARY.test(`${check.summary ?? ""} ${check.label ?? ""}`);
}

function isCompileOrTestKind(check: VerificationCheckResult): boolean {
  return (
    check.kind === "typecheck" ||
    check.kind === "build" ||
    check.kind === "test"
  );
}

function isRootCheck(check: VerificationCheckResult): boolean {
  return isWorkspaceRootCheckId({
    checkId: check.checkId,
    projectId: check.projectId,
  });
}

/**
 * A failed test check that disproves the ask's behavior.
 *
 * Empty-suite exits are harness gaps, not defects. Workspace-root test
 * failures only count when no project-local compile/test check exists
 * (single-package repositories expose only root checks).
 */
export function isBehaviorDefectCheck(
  check: VerificationCheckResult,
  allChecks: readonly VerificationCheckResult[],
): boolean {
  if (check.kind !== "test" || check.outcome !== "failed") {
    return false;
  }
  if (isEmptyTestSuiteSummary(check)) {
    return false;
  }
  if (!isRootCheck(check)) {
    return true;
  }
  return !allChecks.some(
    (other) => isCompileOrTestKind(other) && !isRootCheck(other),
  );
}

export function hasBehaviorDefect(
  checks: readonly VerificationCheckResult[],
): boolean {
  return checks.some((check) => isBehaviorDefectCheck(check, checks));
}

export function hasPassedBehaviorCheck(
  checks: readonly VerificationCheckResult[],
): boolean {
  return checks.some(
    (check) => check.kind === "test" && check.outcome === "passed",
  );
}
