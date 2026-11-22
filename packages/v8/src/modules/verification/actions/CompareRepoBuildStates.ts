import {
  repoBuildStateComparisonSchema,
  type RepoBuildState,
  type RepoBuildStateComparison,
  type RepoBuildStateComparisonReason,
  type VerificationDiagnostic,
} from "../contracts";
import { normalizeVerificationPath } from "../patterns";
import {
  projectLocalCompilePassed,
  selectAskScopedDefects,
} from "./AssessTaskRelevantEvidence";
import { filterActionableDiagnostics } from "./FilterActionableDiagnostics";
import { diagnosticIdentityKey } from "./diagnosticIdentity";

export function compareRepoBuildStates(params: {
  before?: RepoBuildState;
  after: RepoBuildState;
  /** Seed / ask paths — when set, error deltas are NEW∩IN_SCOPE∩ACTIONABLE. */
  askScopePaths?: readonly string[];
  changedFiles?: readonly string[];
}): RepoBuildStateComparison {
  const before = params.before;
  const after = params.after;

  const dropPhantom = projectLocalCompilePassed(after.checks);
  const beforeActionable = filterActionableDiagnostics({
    diagnostics: before?.diagnostics ?? [],
    dropPhantomSecondary: dropPhantom,
    keepSyntheticTestPaths: false,
  }).actionable;
  const afterFiltered = filterActionableDiagnostics({
    diagnostics: after.diagnostics,
    dropPhantomSecondary: dropPhantom,
    keepSyntheticTestPaths: false,
  });
  const afterActionable = afterFiltered.actionable;
  const ignoredResiduals =
    afterFiltered.omitted.length > 0 ||
    (before !== undefined &&
      (before.diagnostics.length !== beforeActionable.length ||
        after.diagnostics.length !== afterActionable.length));

  const scopePaths = uniquePaths([
    ...(params.askScopePaths ?? []),
    ...(params.changedFiles ?? []),
  ]);
  const scopeApplied = scopePaths.length > 0;
  const beforeScoped = scopeApplied
    ? filterActionableToScope(beforeActionable, scopePaths)
    : beforeActionable;
  const afterScoped = scopeApplied
    ? filterActionableToScope(afterActionable, scopePaths)
    : afterActionable;
  const ignoredOutOfScope =
    scopeApplied &&
    (countErrors(afterActionable) > countErrors(afterScoped) ||
      countErrors(beforeActionable) > countErrors(beforeScoped));

  const afterKeys = new Set(afterScoped.map(diagnosticIdentityKey));
  const beforeErrorKeys = new Set(
    beforeScoped
      .filter((diag) => diag.severity === "error")
      .map(diagnosticIdentityKey),
  );
  const afterErrorKeys = new Set(
    afterScoped
      .filter((diag) => diag.severity === "error")
      .map(diagnosticIdentityKey),
  );

  const newErrorCount = [...afterErrorKeys].filter(
    (key) => !beforeErrorKeys.has(key),
  ).length;
  const clearedErrorCount = [...beforeErrorKeys].filter(
    (key) => !afterKeys.has(key),
  ).length;
  const remainingErrorCount = [...afterErrorKeys].filter((key) =>
    beforeErrorKeys.has(key),
  ).length;

  const beforeWarningKeys = new Set(
    beforeScoped
      .filter((diag) => diag.severity === "warning")
      .map(diagnosticIdentityKey),
  );
  const afterWarningKeys = new Set(
    afterScoped
      .filter((diag) => diag.severity === "warning")
      .map(diagnosticIdentityKey),
  );
  const newWarningCount = [...afterWarningKeys].filter(
    (key) => !beforeWarningKeys.has(key),
  ).length;
  const clearedWarningCount = [...beforeWarningKeys].filter(
    (key) => !afterKeys.has(key),
  ).length;

  const afterErrorCount = afterErrorKeys.size;
  const beforeErrorCount = beforeErrorKeys.size;

  const reasonCodes: RepoBuildStateComparisonReason[] = [];
  if (!before) reasonCodes.push("no_before_state");
  if (clearedErrorCount > 0) reasonCodes.push("errors_cleared");
  if (remainingErrorCount > 0 || afterErrorCount > 0) {
    reasonCodes.push("errors_remaining");
  }
  if (newErrorCount > 0) reasonCodes.push("new_errors_introduced");
  if (afterScoped.some((diag) => diag.severity === "warning")) {
    reasonCodes.push("warnings_remaining");
  }
  if (before && newWarningCount > 0) {
    reasonCodes.push("new_warnings_introduced");
  }
  if (before && clearedWarningCount > 0) {
    reasonCodes.push("warnings_cleared");
  }
  if (after.summary.failedCheckIds.length > 0) {
    reasonCodes.push("checks_still_failing");
  }
  if (ignoredResiduals) {
    reasonCodes.push("non_actionable_residuals_ignored");
  }
  if (ignoredOutOfScope) {
    reasonCodes.push("out_of_scope_residuals_ignored");
  }

  return repoBuildStateComparisonSchema.parse({
    beforeErrorCount,
    afterErrorCount,
    clearedErrorCount,
    newErrorCount,
    remainingErrorCount,
    ...(before ? { newWarningCount, clearedWarningCount } : {}),
    failedCheckIdsBefore: before?.summary.failedCheckIds ?? [],
    failedCheckIdsAfter: after.summary.failedCheckIds,
    reasonCodes: [...new Set(reasonCodes)],
  });
}

/**
 * Errors use ask-scoped defect selection; warnings use path membership only.
 */
function filterActionableToScope(
  diagnostics: readonly VerificationDiagnostic[],
  scopePaths: readonly string[],
): VerificationDiagnostic[] {
  const errors = selectAskScopedDefects(diagnostics, scopePaths);
  const errorKeys = new Set(errors.map(diagnosticIdentityKey));
  const warnings = diagnostics.filter((diag) => {
    if (diag.severity !== "warning") {
      return false;
    }
    const pathKey = normalizeVerificationPath(diag.path).toLowerCase();
    return scopePaths.some((scope) => {
      const scopeKey = scope.toLowerCase();
      return (
        pathKey === scopeKey ||
        pathKey.startsWith(`${scopeKey}/`) ||
        scopeKey.startsWith(`${pathKey}/`)
      );
    });
  });
  return [...errors, ...warnings.filter((w) => !errorKeys.has(diagnosticIdentityKey(w)))];
}

function countErrors(diagnostics: readonly VerificationDiagnostic[]): number {
  return diagnostics.filter((diag) => diag.severity === "error").length;
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
