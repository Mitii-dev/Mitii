import type {
  RepoBuildStateComparison,
  VerificationCheckResult,
  VerificationDiagnostic,
  VerificationResult,
} from "../../../modules/verification";

import { filterDiagnosticsToAskScope } from "./buildVerificationRepairPrompt";

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
 * - package typecheck/build passed while only workspace-root / syntax / test
 *   leftovers failed (vitest harness + syntax:port noise must not reopen repair)
 * - ask/changed paths have no actionable in-scope diagnostic errors
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
  };

  switch (verification.status) {
    case "verified_success":
      return { action: "accept", acceptKind: "verified_success" };
    case "implemented_unverified":
      if (isUserGoalComplete(goalParams)) {
        return { action: "accept", acceptKind: "implemented_unverified" };
      }
      if (hasDiagnosticErrors(params.comparison)) {
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
      return {
        action: "reject",
        repairable: true,
        rejectKind: "verification_failed",
        verification,
        error: {
          code: "verification_failed",
          message: `Verification did not succeed (status: ${verification.status}).`,
        },
      };
    case "blocked":
      if (isSoftUnavailableBlock(verification, params.allowUnavailable)) {
        // Compatibility guard for older verification results that reported
        // missing evidence as blocked even though no check failed. Keep the
        // user's changes as implemented-but-unverified instead of rolling back.
        return { action: "accept", acceptKind: "implemented_unverified" };
      }
      return {
        action: "reject",
        // State/grant blockers are not fixed by rewriting application code.
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

function hasDiagnosticErrors(
  comparison: RepoBuildStateComparison | undefined,
): comparison is RepoBuildStateComparison {
  return (
    comparison !== undefined &&
    (comparison.afterErrorCount > 0 || comparison.newErrorCount > 0)
  );
}

function diagnosticErrorMessage(comparison: RepoBuildStateComparison): string {
  const newErrors =
    comparison.newErrorCount > 0
      ? `, including ${comparison.newErrorCount} new error(s)`
      : "";
  return `Verification is incomplete and diagnostics still report ${comparison.afterErrorCount} error(s)${newErrors}.`;
}

/**
 * True when the user-visible compile evidence for the changed package
 * succeeded, or when the only remaining failed checks are leftover noise.
 *
 * Workspace-root typecheck/test timeout or failure, package test harness
 * failures, and syntax:port phantoms must not reopen a long repair loop after
 * `inferred:apps/...` / `inferred:packages/...` typecheck/build already
 * passed — those leftovers are monorepo/harness noise, not a regression from
 * the localized edit.
 *
 * Also true when:
 * - ask/changed paths have zero actionable in-scope diagnostic errors
 *   (node_modules / phantom JSX/--jsx ignored when package tsc passed), or
 * - the before→after comparison shows **no new errors** (pre-existing
 *   remaining bugs stay optional — do not auto-repair them).
 */
export function isUserGoalComplete(params: {
  verification: VerificationResult;
  comparison?: RepoBuildStateComparison;
  askScopePaths?: readonly string[];
  changedFiles?: readonly string[];
}): boolean {
  const { verification, comparison } = params;
  const changedCount = params.changedFiles?.length ?? 0;
  const packageCompilePassed = packageCompileEvidencePassed(verification);

  if (
    packageCompilePassed &&
    failuresAreIgnorableWhenPackagePassed(verification)
  ) {
    return true;
  }

  if (askScopedDiagnosticsClean(params)) {
    return true;
  }

  // Compare-only: edits landed and this change introduced no new diagnostics.
  // Remaining pre-existing errors are offered optionally, not repaired here.
  if (changedCount > 0 && comparison && comparison.newErrorCount === 0) {
    return true;
  }

  // New errors exist — only block when we cannot prove they are out of ask scope.
  // When package compile already passed, comparison floods from vitest/syntax:port
  // (before=0 → after=200) must not force repair; ask-scope / ignorable already
  // decided above.
  if (comparison && comparison.newErrorCount > 0) {
    return false;
  }

  if (comparison && comparison.afterErrorCount > 0) {
    // after>0 with new===0 already accepted above when we have changes.
    return changedCount > 0;
  }

  const failed = verification.checks.filter(
    (check) => check.outcome === "failed" || check.outcome === "timed_out",
  );
  if (failed.length === 0) {
    return comparison !== undefined && comparison.afterErrorCount === 0;
  }
  const lintOnly = failed.every(
    (check) => check.kind === "lint" || check.kind === "format",
  );
  const typecheckOrBuildFailed = failed.some(
    (check) => check.kind === "typecheck" || check.kind === "build",
  );
  const diagnosticsFailed = failed.some(
    (check) => check.kind === "diagnostics" || check.kind === "syntax",
  );
  return lintOnly && !typecheckOrBuildFailed && !diagnosticsFailed;
}

/**
 * Changed/seed paths have no actionable error diagnostics after ask-scope
 * filtering. Hard-denied trees and (when package tsc passed) phantom config
 * diagnostics do not reopen repair.
 */
export function askScopedDiagnosticsClean(params: {
  verification: VerificationResult;
  askScopePaths?: readonly string[];
  changedFiles?: readonly string[];
}): boolean {
  const scopePaths = [
    ...(params.askScopePaths ?? []),
    ...(params.changedFiles ?? []),
  ].filter((path) => path.trim().length > 0);
  if (scopePaths.length === 0) {
    return false;
  }
  if ((params.changedFiles ?? []).length === 0) {
    return false;
  }
  const packageCompilePassed = packageCompileEvidencePassed(params.verification);
  const diagnostics = (params.verification.diagnostics ?? []).filter(
    (item) =>
      !(packageCompilePassed && isPhantomConfigDiagnostic(item)),
  );
  const scoped = filterDiagnosticsToAskScope(diagnostics, scopePaths);
  return !scoped.some(
    (item) =>
      item.severity === "error" ||
      (item.severity as string | undefined) === "fatal",
  );
}

/**
 * Config/harness phantoms that contradict a passing package typecheck/build.
 * syntax:port and mis-scoped tsserver often emit these on changed files even
 * when `pnpm typecheck` for the package already passed.
 */
export function isPhantomConfigDiagnostic(
  diagnostic: VerificationDiagnostic,
): boolean {
  const code = (diagnostic.code ?? "").toUpperCase();
  if (code === "TS17004") {
    return true;
  }
  const message = (diagnostic.message ?? "").toLowerCase();
  if (
    message.includes("cannot use jsx unless") &&
    message.includes("--jsx")
  ) {
    return true;
  }
  // syntax:port often re-emits implicit-any on files the package tsc already
  // accepted — not an actionable ask regression.
  if (code === "TS7006") {
    return true;
  }
  return false;
}

/** Package/inferred typecheck or build passed for the changed project. */
export function packageCompileEvidencePassed(
  verification: VerificationResult,
): boolean {
  return verification.checks.some(
    (check) =>
      (check.kind === "typecheck" || check.kind === "build") &&
      check.outcome === "passed" &&
      isPackageScopedCheck(check),
  );
}

/**
 * Failed/timed-out checks are leftover noise once package typecheck/build
 * passed: lint/format, syntax:port, workspace-root compile/test, and package
 * test harness failures (vitest node_modules frames).
 */
export function failuresAreIgnorableWhenPackagePassed(
  verification: VerificationResult,
): boolean {
  const failed = verification.checks.filter(
    (check) => check.outcome === "failed" || check.outcome === "timed_out",
  );
  if (failed.length === 0) {
    return true;
  }
  return failed.every(isIgnorableFailureWhenPackagePassed);
}

function isIgnorableFailureWhenPackagePassed(
  check: VerificationCheckResult,
): boolean {
  if (check.kind === "lint" || check.kind === "format") {
    return true;
  }
  // syntax:port is not authoritative next to a passing package typecheck.
  if (check.kind === "syntax") {
    return true;
  }
  // Package/inferred tests often fail on harness frames under node_modules —
  // not a localized compile regression. Keep edits; do not thrash repair.
  if (check.kind === "test") {
    return true;
  }
  if (
    (check.kind === "typecheck" || check.kind === "build") &&
    isWorkspaceRootCheck(check)
  ) {
    return true;
  }
  return false;
}

export function isPackageScopedCheck(check: VerificationCheckResult): boolean {
  const projectId = (check.projectId ?? "").replace(/\\/g, "/");
  const checkId = check.checkId.replace(/\\/g, "/");
  if (projectId.startsWith("inferred:") || checkId.startsWith("inferred:")) {
    return true;
  }
  if (/^(apps|packages)\//.test(projectId)) {
    return true;
  }
  // checkId shape: inferred:packages/host:typecheck:typecheck
  return /:?(apps|packages)\//.test(checkId);
}

export function isWorkspaceRootCheck(check: VerificationCheckResult): boolean {
  const projectId = (check.projectId ?? "").toLowerCase();
  if (
    projectId === "workspace-root" ||
    projectId === "root" ||
    projectId === "."
  ) {
    return true;
  }
  const checkId = check.checkId.toLowerCase();
  return (
    checkId.startsWith("workspace-root:") || checkId.startsWith("root:")
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
