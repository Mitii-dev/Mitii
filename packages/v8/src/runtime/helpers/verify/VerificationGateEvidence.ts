import {
  assessTaskRelevantEvidence,
  isPhantomSecondaryDiagnostic,
  isWorkspaceRootCheckId,
  projectLocalCompilePassed,
  type VerificationCheckResult,
  type VerificationDiagnostic,
  type VerificationResult,
} from "../../../modules/verification";

export function isPhantomConfigDiagnostic(
  diagnostic: VerificationDiagnostic,
): boolean {
  return isPhantomSecondaryDiagnostic({
    code: diagnostic.code,
    message: diagnostic.message,
  });
}

/** Project-local typecheck/build passed — thin wrapper over Verification. */
export function packageCompileEvidencePassed(
  verification: VerificationResult,
): boolean {
  return projectLocalCompilePassed(verification.checks);
}

/**
 * Failed/timed-out checks are leftover noise once project-local compile passed.
 * Delegates to Verification assessor (does not blanket-ignore ask-scoped tests
 * when actionable source diagnostics remain).
 */
export function failuresAreIgnorableWhenPackagePassed(
  verification: VerificationResult,
): boolean {
  if (!projectLocalCompilePassed(verification.checks)) {
    return false;
  }
  const assessment = assessTaskRelevantEvidence({
    verification: {
      required: true,
      minimumEvidence: [],
      allowUnavailable: true,
    },
    checks: verification.checks,
    diagnostics: verification.diagnostics,
  });
  return assessment.shouldAccept;
}

/** @deprecated Prefer project-local compile via `projectLocalCompilePassed`. */
export function isPackageScopedCheck(check: VerificationCheckResult): boolean {
  return !isWorkspaceRootCheck(check);
}

export function isWorkspaceRootCheck(check: VerificationCheckResult): boolean {
  return isWorkspaceRootCheckId({
    checkId: check.checkId,
    projectId: check.projectId,
  });
}

export function askScopedDiagnosticsClean(params: {
  verification: VerificationResult;
  askScopePaths?: readonly string[];
  changedFiles?: readonly string[];
}): boolean {
  const changed = params.changedFiles ?? [];
  if (changed.length === 0) {
    return false;
  }
  const assessment = assessTaskRelevantEvidence({
    verification: {
      required: true,
      minimumEvidence: [],
      allowUnavailable: true,
    },
    checks: params.verification.checks,
    diagnostics: params.verification.diagnostics,
    changedFiles: changed,
    askScopePaths: params.askScopePaths ?? changed,
  });
  return (
    assessment.authoritativeCompilePassed &&
    assessment.actionableDiagnostics.filter(
      (item) =>
        item.severity === "error" ||
        (item.severity as string | undefined) === "fatal",
    ).length === 0
  );
}

