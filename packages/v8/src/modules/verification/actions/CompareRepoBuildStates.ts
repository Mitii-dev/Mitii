import {
  repoBuildStateComparisonSchema,
  type RepoBuildState,
  type RepoBuildStateComparison,
  type RepoBuildStateComparisonReason,
} from "../contracts";
import { filterActionableDiagnostics } from "./FilterActionableDiagnostics";
import { projectLocalCompilePassed } from "./AssessTaskRelevantEvidence";

export function compareRepoBuildStates(params: {
  before?: RepoBuildState;
  after: RepoBuildState;
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

  const afterKeys = new Set(afterActionable.map(diagnosticKey));
  const beforeErrorKeys = new Set(
    beforeActionable
      .filter((diag) => diag.severity === "error")
      .map(diagnosticKey),
  );
  const afterErrorKeys = new Set(
    afterActionable
      .filter((diag) => diag.severity === "error")
      .map(diagnosticKey),
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
    beforeActionable
      .filter((diag) => diag.severity === "warning")
      .map(diagnosticKey),
  );
  const afterWarningKeys = new Set(
    afterActionable
      .filter((diag) => diag.severity === "warning")
      .map(diagnosticKey),
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
  if (afterActionable.some((diag) => diag.severity === "warning")) {
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

function diagnosticKey(diag: RepoBuildState["diagnostics"][number]): string {
  return [
    diag.path,
    diag.severity,
    diag.startLine ?? "",
    diag.startColumn ?? "",
    diag.source ?? "",
    diag.code ?? "",
    diag.message,
  ].join("\u0000");
}
