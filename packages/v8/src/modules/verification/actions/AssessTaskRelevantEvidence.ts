import type { VerificationRequirement } from "../../decision-policy";

import type {
  VerificationCheckResult,
  VerificationDiagnostic,
  VerificationReasonCode,
} from "../contracts";
import {
  isPhantomSecondaryDiagnostic,
  isWorkspaceRootCheckId,
  normalizeVerificationPath,
} from "../patterns";
import { filterActionableDiagnostics } from "./FilterActionableDiagnostics";

export type TaskRelevantResidualKind =
  | "none"
  | "harness_noise"
  | "phantom_secondary"
  | "workspace_root_noise"
  | "ask_scoped_defect"
  | "unclassified_failure";

export interface TaskRelevantEvidenceAssessment {
  /** Project-local typecheck or build passed (authoritative compile evidence). */
  authoritativeCompilePassed: boolean;
  /** True when the user goal is proven and repair must not open. */
  shouldAccept: boolean;
  residualKind: TaskRelevantResidualKind;
  actionableDiagnostics: VerificationDiagnostic[];
  reasonCodes: VerificationReasonCode[];
}

/**
 * Classify whether verification failures are residual noise after the
 * task-relevant compile evidence already passed.
 *
 * Generic rules (no apps/packages or single-toolchain hardcoding):
 * 1. Authoritative evidence = passed typecheck/build that is not workspace-root.
 * 2. If that passed, failed syntax / workspace-root compile leftovers and
 *    harness/denied diagnostics are residuals — accept.
 * 3. Failed tests with ask-scoped / parseable assertion diagnostics remain
 *    defects when `minimumEvidence` includes `tests`. Empty-suite / unparsed
 *    test exits stay harness noise (common for single-package fixtures before
 *    host-injected oracles). Optional tests remain harness noise.
 * 4. Without authoritative compile, do not soft-accept failed checks.
 *    Sole workspace-root build/typecheck counts when no project-local compile
 *    check ran (single-package fixtures).
 */
export function assessTaskRelevantEvidence(params: {
  verification: VerificationRequirement;
  checks: readonly VerificationCheckResult[];
  diagnostics?: readonly VerificationDiagnostic[];
  changedFiles?: readonly string[];
  askScopePaths?: readonly string[];
}): TaskRelevantEvidenceAssessment {
  const checks = params.checks;
  const authoritativeCompilePassed = resolveAuthoritativeCompilePassed(checks);
  const diagnostics = params.diagnostics ?? [];
  const testsRequired = params.verification.minimumEvidence.includes("tests");

  const filtered = filterActionableDiagnostics({
    diagnostics,
    dropPhantomSecondary: authoritativeCompilePassed,
    keepSyntheticTestPaths: true,
  });

  const scopePaths = uniquePaths([
    ...(params.askScopePaths ?? []),
    ...(params.changedFiles ?? []),
  ]);
  const askScopedDefects = selectAskScopedDefects(
    filtered.actionable,
    scopePaths,
  );

  const failed = checks.filter(
    (check) => check.outcome === "failed" || check.outcome === "timed_out",
  );

  if (failed.length === 0 && askScopedDefects.length === 0) {
    return {
      authoritativeCompilePassed,
      shouldAccept: true,
      residualKind: "none",
      actionableDiagnostics: filtered.actionable,
      reasonCodes: authoritativeCompilePassed
        ? ["task_relevant_evidence_passed", "checks_passed"]
        : ["checks_passed"],
    };
  }

  if (!authoritativeCompilePassed) {
    return {
      authoritativeCompilePassed: false,
      shouldAccept: false,
      residualKind:
        askScopedDefects.length > 0
          ? "ask_scoped_defect"
          : "unclassified_failure",
      actionableDiagnostics: filtered.actionable,
      reasonCodes: ["checks_failed"],
    };
  }

  // Authoritative compile passed — ask-scoped source defects still block.
  if (askScopedDefects.length > 0) {
    return {
      authoritativeCompilePassed: true,
      shouldAccept: false,
      residualKind: "ask_scoped_defect",
      actionableDiagnostics: filtered.actionable,
      reasonCodes: ["checks_failed"],
    };
  }

  // Every failed check must be an ignorable residual class.
  for (const check of failed) {
    if (
      !isIgnorableResidualCheck(check, {
        testsRequired,
        actionableDiagnostics: filtered.actionable,
      })
    ) {
      return {
        authoritativeCompilePassed: true,
        shouldAccept: false,
        residualKind: "unclassified_failure",
        actionableDiagnostics: filtered.actionable,
        reasonCodes: ["checks_failed"],
      };
    }
  }

  const residualCodes: VerificationReasonCode[] = [
    "task_relevant_evidence_passed",
  ];
  let residualKind: TaskRelevantResidualKind = "none";

  if (failed.some((check) => check.kind === "syntax") ||
    diagnostics.some((diagnostic) =>
      isPhantomSecondaryDiagnostic({
        code: diagnostic.code,
        message: diagnostic.message,
      }),
    )) {
    residualCodes.push("residual_phantom_secondary");
    residualKind = "phantom_secondary";
  }
  if (
    failed.some((check) => check.kind === "test") ||
    filtered.omitted.length > 0
  ) {
    residualCodes.push("residual_harness_noise");
    if (residualKind === "none") {
      residualKind = "harness_noise";
    }
  }
  if (
    failed.some(
      (check) =>
        (check.kind === "typecheck" ||
          check.kind === "build" ||
          check.kind === "test") &&
        isWorkspaceRootCheckId({
          checkId: check.checkId,
          projectId: check.projectId,
        }),
    )
  ) {
    residualCodes.push("residual_workspace_root_noise");
    if (residualKind === "none") {
      residualKind = "workspace_root_noise";
    }
  }
  if (failed.some((check) => check.kind === "lint" || check.kind === "format")) {
    if (residualKind === "none") {
      residualKind = "harness_noise";
    }
    if (!residualCodes.includes("residual_harness_noise")) {
      residualCodes.push("residual_harness_noise");
    }
  }

  return {
    authoritativeCompilePassed: true,
    shouldAccept: true,
    residualKind,
    actionableDiagnostics: filtered.actionable,
    reasonCodes: [...new Set(residualCodes)],
  };
}

/** Project-local (non workspace-root) typecheck or build passed. */
export function projectLocalCompilePassed(
  checks: readonly VerificationCheckResult[],
): boolean {
  return checks.some(
    (check) =>
      (check.kind === "typecheck" || check.kind === "build") &&
      check.outcome === "passed" &&
      !isWorkspaceRootCheckId({
        checkId: check.checkId,
        projectId: check.projectId,
      }),
  );
}

function resolveAuthoritativeCompilePassed(
  checks: readonly VerificationCheckResult[],
): boolean {
  if (projectLocalCompilePassed(checks)) {
    return true;
  }
  // Single-package fixtures only expose workspace-root compile checks.
  const hasProjectLocalCompile = checks.some(
    (check) =>
      (check.kind === "typecheck" || check.kind === "build") &&
      !isWorkspaceRootCheckId({
        checkId: check.checkId,
        projectId: check.projectId,
      }),
  );
  if (hasProjectLocalCompile) {
    return false;
  }
  return checks.some(
    (check) =>
      (check.kind === "typecheck" || check.kind === "build") &&
      check.outcome === "passed" &&
      isWorkspaceRootCheckId({
        checkId: check.checkId,
        projectId: check.projectId,
      }),
  );
}

function isIgnorableResidualCheck(
  check: VerificationCheckResult,
  options: {
    testsRequired: boolean;
    actionableDiagnostics: readonly VerificationDiagnostic[];
  },
): boolean {
  if (check.kind === "lint" || check.kind === "format") {
    return true;
  }
  if (check.kind === "syntax") {
    return true;
  }
  // Required tests with parseable assertion/source rows are defects.
  // Empty-suite / unparsed exits stay harness noise.
  if (check.kind === "test") {
    if (!options.testsRequired) {
      return true;
    }
    return isEmptyTestHarnessFailure(check, options.actionableDiagnostics);
  }
  if (
    (check.kind === "typecheck" || check.kind === "build") &&
    isWorkspaceRootCheckId({
      checkId: check.checkId,
      projectId: check.projectId,
    })
  ) {
    return true;
  }
  return false;
}

function isEmptyTestHarnessFailure(
  check: VerificationCheckResult,
  actionableDiagnostics: readonly VerificationDiagnostic[],
): boolean {
  if (actionableDiagnostics.length > 0) {
    return false;
  }
  const summary = `${check.summary ?? ""} ${check.label ?? ""}`.toLowerCase();
  return (
    /no test files?|no tests? found|0 tests?|did not (run|find) any test|no test specified/i.test(
      summary,
    ) ||
    // Selected test script failed with nothing parseable — typical empty
    // fixture / pre-oracle harness noise, not a product assertion.
    summary.length > 0
  );
}

/**
 * Error diagnostics that look like real source defects under ask/changed paths.
 * Synthetic `<test>` assertion rows count when present (tests evidence path).
 *
 * Shared by assess + compare so NEW∩IN_SCOPE∩ACTIONABLE uses one rule.
 */
export function selectAskScopedDefects(
  diagnostics: readonly VerificationDiagnostic[],
  scopePaths: readonly string[],
): VerificationDiagnostic[] {
  const errors = diagnostics.filter(
    (item) =>
      item.severity === "error" ||
      (item.severity as string | undefined) === "fatal",
  );
  if (errors.length === 0) {
    return [];
  }

  const inScope = (diagnostic: VerificationDiagnostic): boolean => {
    const path = normalizeVerificationPath(diagnostic.path);
    if (isSyntheticPath(path)) {
      // Synthetic assertion without a file — only a defect when tests left
      // a real assertion body (not a bare digit leftover).
      return /assertion|expected|received|failed|error/i.test(
        diagnostic.message,
      );
    }
    if (scopePaths.length === 0) {
      return pathLooksLikeSource(path);
    }
    const pathKey = path.toLowerCase();
    return scopePaths.some((scope) => {
      const scopeKey = scope.toLowerCase();
      return (
        pathKey === scopeKey ||
        pathKey.startsWith(`${scopeKey}/`) ||
        scopeKey.startsWith(`${pathKey}/`)
      );
    });
  };

  return errors.filter((diagnostic) => {
    const path = normalizeVerificationPath(diagnostic.path);
    if (isSyntheticPath(path)) {
      return inScope(diagnostic);
    }
    return inScope(diagnostic) && pathLooksLikeSource(path);
  });
}

function isSyntheticPath(path: string): boolean {
  const lower = path.toLowerCase();
  return lower === "<test>" || lower === "<unknown>" || lower === "<stdin>";
}

function pathLooksLikeSource(path: string): boolean {
  if (!path || isSyntheticPath(path)) {
    return false;
  }
  return /\.[A-Za-z0-9]+$/.test(path) || path.includes("/");
}

function uniquePaths(paths: readonly string[]): string[] {
  return [
    ...new Set(
      paths
        .map(normalizeVerificationPath)
        .filter((path) => path.length > 0),
    ),
  ];
}
