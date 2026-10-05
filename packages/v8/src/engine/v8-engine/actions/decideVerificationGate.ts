import type { VerificationRequirement } from "../../../modules/decision-policy";
import {
  assessTaskRelevantEvidence,
  isPhantomSecondaryDiagnostic,
  isWorkspaceRootCheckId,
  projectLocalCompilePassed,
  type RepoBuildStateComparison,
  type VerificationCheckResult,
  type VerificationDiagnostic,
  type VerificationResult,
} from "../../../modules/verification";

/**
 * Pure decision for how Agent Engine should treat a Verification result.
 *
 * Segregates accept vs reject so mutation commit/rollback is not driven by
 * ad-hoc if-chains that conflate "checks failed" with "checks unavailable".
 *
 * Accept (commit mutations):
 * - verification not required / no changed files
 * - verified_success
 * - implemented_unverified (work done; evidence incomplete — keep changes)
 * - verification infrastructure missing AND allowUnavailable
 * - task-relevant project-local typecheck/build passed with only harness /
 *   phantom / workspace-root residuals (Verification `assessTaskRelevantEvidence`)
 * - before→after actionable compare shows no new in-scope errors
 *
 * Reject (eligible for repair only when repairable):
 * - verification_failed → repairable (model can fix the change)
 * - hard blocked / cancelled / infrastructure missing → not repairable
 */
export type VerificationGateDecision =
  | {
      action: "accept";
      acceptKind:
        | "verified_success"
        | "implemented_unverified"
        | "skipped_not_required"
        | "unavailable_allowed";
    }
  | {
      action: "reject";
      repairable: boolean;
      rejectKind:
        | "verification_failed"
        | "no_mutation_performed"
        | "blocked"
        | "cancelled"
        | "infrastructure_unavailable";
      error: { code: string; message: string };
      verification?: VerificationResult;
    };

/**
 * Terminal run status after a verification gate rejection.
 *
 * Kept edits after a failed verify still fail the task (honest).
 * `no_mutation_performed` must also fail — never report completed when the
 * gate required a workspace mutation that never landed (fe-bugfix-018-class).
 */
export function resolveFailedVerificationTerminalStatus(params: {
  changedFileCount: number;
  rejectKind: Extract<
    VerificationGateDecision,
    { action: "reject" }
  >["rejectKind"];
}): "failed" | "completed" {
  if (params.rejectKind === "no_mutation_performed") {
    return "failed";
  }
  if (params.changedFileCount > 0) {
    return "failed";
  }
  return "completed";
}

export function decideVerificationGate(params: {
  verificationRequired: boolean;
  allowUnavailable: boolean;
  changedFileCount: number;
  mutationRequired?: boolean;
  canVerify: boolean;
  missingInfrastructure?: readonly string[];
  verification?: VerificationResult;
  comparison?: RepoBuildStateComparison;
  /** Changed / seed paths — used to ignore unrelated package noise. */
  askScopePaths?: readonly string[];
  changedFiles?: readonly string[];
  /** Decision-policy minimum evidence kinds (e.g. includes `tests`). */
  minimumEvidence?: readonly string[];
}): VerificationGateDecision {
  if (params.mutationRequired && params.changedFileCount === 0) {
    return {
      action: "reject",
      repairable: false,
      rejectKind: "no_mutation_performed",
      error: {
        code: "no_mutation_performed",
        message:
          "The task required workspace edits, but the model completed without changing any files.",
      },
    };
  }

  if (!params.verificationRequired || params.changedFileCount === 0) {
    return { action: "accept", acceptKind: "skipped_not_required" };
  }

  if (!params.canVerify) {
    if (params.allowUnavailable) {
      return { action: "accept", acceptKind: "unavailable_allowed" };
    }
    const missing =
      params.missingInfrastructure && params.missingInfrastructure.length > 0
        ? params.missingInfrastructure.join(", ")
        : "verification port or pinned state";
    return {
      action: "reject",
      repairable: false,
      rejectKind: "infrastructure_unavailable",
      error: {
        code: "verification_failed",
        message: `Verification is required but unavailable (missing ${missing}).`,
      },
    };
  }

  const verification = params.verification;
  if (!verification) {
    return {
      action: "reject",
      repairable: false,
      rejectKind: "infrastructure_unavailable",
      error: {
        code: "verification_failed",
        message: "Verification is required but produced no result.",
      },
    };
  }

  const goalParams = {
    verification,
    comparison: params.comparison,
    askScopePaths: params.askScopePaths,
    changedFiles: params.changedFiles,
    minimumEvidence: params.minimumEvidence,
  };

  switch (verification.status) {
    case "verified_success":
      return { action: "accept", acceptKind: "verified_success" };
    case "implemented_unverified":
      if (isUserGoalComplete(goalParams)) {
        return { action: "accept", acceptKind: "implemented_unverified" };
      }
      if (hasInScopeActionableRepairTarget(goalParams)) {
        return {
          action: "reject",
          repairable: true,
          rejectKind: "verification_failed",
          verification,
          error: {
            code: "verification_failed",
            message: diagnosticErrorMessage(params.comparison),
          },
        };
      }
      // Architecture: "implementation completed but verification unavailable".
      // Keep mutations; do not roll back a successful edit for missing scripts.
      return { action: "accept", acceptKind: "implemented_unverified" };
    case "verification_failed":
      if (isUserGoalComplete(goalParams)) {
        return { action: "accept", acceptKind: "implemented_unverified" };
      }
      // Phase 2: repair only for NEW∩IN_SCOPE∩ACTIONABLE (or ask-scoped /
      // failed authoritative evidence the model can still address).
      return {
        action: "reject",
        repairable: hasInScopeActionableRepairTarget(goalParams),
        rejectKind: "verification_failed",
        verification,
        error: {
          code: "verification_failed",
          message: `Verification did not succeed (status: ${verification.status}).`,
        },
      };
    case "blocked":
      if (isSoftUnavailableBlock(verification, params.allowUnavailable)) {
        return { action: "accept", acceptKind: "implemented_unverified" };
      }
      return {
        action: "reject",
        repairable: false,
        rejectKind: "blocked",
        verification,
        error: {
          code: "verification_failed",
          message: `Verification did not succeed (status: ${verification.status}).`,
        },
      };
    case "cancelled":
      return {
        action: "reject",
        repairable: false,
        rejectKind: "cancelled",
        verification,
        error: {
          code: "verification_failed",
          message: `Verification did not succeed (status: ${verification.status}).`,
        },
      };
    default: {
      const exhaustive: never = verification.status;
      return {
        action: "reject",
        repairable: false,
        rejectKind: "blocked",
        verification,
        error: {
          code: "verification_failed",
          message: `Verification returned unrecognized status: ${String(exhaustive)}.`,
        },
      };
    }
  }
}

/**
 * Repair opens only for in-scope actionable work:
 * - NEW in-scope actionable compare delta, or
 * - ask-scoped source defects, or
 * - failed project-local compile without soft-accept (suite/compile may
 *   fail without parseable in-scope rows).
 */
function hasInScopeActionableRepairTarget(params: {
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
    },
    checks: params.verification.checks,
    diagnostics: params.verification.diagnostics,
    changedFiles: params.changedFiles,
    askScopePaths: params.askScopePaths,
  });
  if (assessment.residualKind === "ask_scoped_defect") {
    return true;
  }
  // Failed required evidence (including tests) is repairable even when
  // project-local compile already passed.
  if (!assessment.shouldAccept) {
    return true;
  }
  return false;
}

function diagnosticErrorMessage(
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
 * Residual classification (harness / phantom / workspace-root) is owned by
 * `@mitii/v8` Verification — this gate only orchestrates accept vs repair.
 */
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
    },
    checks: verification.checks,
    diagnostics: verification.diagnostics,
    changedFiles: params.changedFiles,
    askScopePaths: params.askScopePaths,
  });
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

  const hasFailedCheck = verification.checks.some(
    (check) => check.outcome === "failed" || check.outcome === "timed_out",
  );

  // Compare-only: edits landed and actionable compare introduced no new
  // errors. Do not soft-accept when selected checks failed and the assessor
  // did not classify them as ignorable residuals (e.g. required tests).
  if (changedCount > 0 && comparison && comparison.newErrorCount === 0) {
    if (!hasFailedCheck || assessment.shouldAccept) {
      return true;
    }
  }

  if (comparison && comparison.newErrorCount > 0) {
    return false;
  }

  if (comparison && comparison.afterErrorCount > 0) {
    return changedCount > 0 && assessment.shouldAccept;
  }

  return assessment.shouldAccept;
}

function normalizeMinimumEvidence(
  value: readonly string[] | undefined,
): VerificationRequirement["minimumEvidence"] {
  const allowed = new Set<VerificationRequirement["minimumEvidence"][number]>([
    "diagnostics",
    "diff_review",
    "typecheck",
    "tests",
    "build",
  ]);
  if (!value || value.length === 0) {
    return [];
  }
  return value.filter(
    (item): item is VerificationRequirement["minimumEvidence"][number] =>
      allowed.has(item as VerificationRequirement["minimumEvidence"][number]),
  );
}

/** @deprecated Prefer `isPhantomSecondaryDiagnostic` from verification. */
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

function isSoftUnavailableBlock(
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
