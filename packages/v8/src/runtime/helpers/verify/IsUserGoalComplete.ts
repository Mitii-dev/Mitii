import type { VerificationRequirement } from "../../../modules/decision-policy";
import {
  assessTaskRelevantEvidence,
  hasBehaviorDefect,
  requiresBehaviorEvidence,
  isWorkspaceRootCheckId,
  type RepoBuildStateComparison,
  type VerificationCheckResult,
  type VerificationResult,
} from "../../../modules/verification";

export function isUserGoalComplete(params: {
  verification: VerificationResult;
  comparison?: RepoBuildStateComparison;
  askScopePaths?: readonly string[];
  changedFiles?: readonly string[];
  minimumEvidence?: readonly string[];
}): boolean {
  const { verification, comparison } = params;
  const changedCount = params.changedFiles?.length ?? 0;
  const minimumEvidence = normalizeMinimumEvidence(params.minimumEvidence);

  const assessment = assessTaskRelevantEvidence({
    verification: {
      required: true,
      minimumEvidence,
      allowUnavailable: true,
      onFailure: "report",
    },
    checks: verification.checks,
    diagnostics: verification.diagnostics,
    changedFiles: params.changedFiles,
    askScopePaths: params.askScopePaths,
  });
  // Behavior-implied asks never soft-accept past a failed test/smoke suite.
  if (
    requiresBehaviorEvidence(minimumEvidence) &&
    hasBehaviorDefect(verification.checks)
  ) {
    return false;
  }
  if (assessment.shouldAccept && assessment.authoritativeCompilePassed) {
    return true;
  }
  if (
    assessment.shouldAccept &&
    verification.reasonCodes.some((code) =>
      code.startsWith("residual_") || code === "task_relevant_evidence_passed",
    )
  ) {
    return true;
  }

  if (comparison && comparison.newErrorCount > 0) {
    return false;
  }

  // Compare-only soft-accept: edits landed and actionable compare introduced
  // no new in-scope errors. Keep rejecting ask-connected defects and failed
  // project-local compile; pre-existing workspace-root / suite noise is a
  // leftover for the user, not a hard fail.
  if (changedCount > 0 && comparison && comparison.newErrorCount === 0) {
    if (assessment.residualKind === "ask_scoped_defect") {
      return false;
    }
    if (hasFailedProjectLocalCompile(verification.checks)) {
      return false;
    }
    return true;
  }

  if (comparison && comparison.afterErrorCount > 0) {
    return changedCount > 0 && assessment.shouldAccept;
  }

  return assessment.shouldAccept;
}

/** Failed typecheck/build on a non-workspace-root project (repairable). */
export function hasFailedProjectLocalCompile(
  checks: readonly VerificationCheckResult[],
): boolean {
  return checks.some(
    (check) =>
      (check.kind === "typecheck" || check.kind === "build") &&
      (check.outcome === "failed" || check.outcome === "timed_out") &&
      !isWorkspaceRootCheckId({
        checkId: check.checkId,
        projectId: check.projectId,
      }),
  );
}

export function normalizeMinimumEvidence(
  value: readonly string[] | undefined,
): VerificationRequirement["minimumEvidence"] {
  const allowed = new Set<VerificationRequirement["minimumEvidence"][number]>([
    "diagnostics",
    "diff_review",
    "typecheck",
    "tests",
    "build",
    "behavior",
  ]);
  if (!value || value.length === 0) {
    return [];
  }
  return value.filter(
    (item): item is VerificationRequirement["minimumEvidence"][number] =>
      allowed.has(item as VerificationRequirement["minimumEvidence"][number]),
  );
}
