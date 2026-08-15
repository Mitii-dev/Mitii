import {
  repoBuildStateComparisonSchema,
  type RepoBuildState,
  type RepoBuildStateComparison,
  type RepoBuildStateComparisonReason,
} from "../contracts";

export function compareRepoBuildStates(params: {
  before?: RepoBuildState;
  after: RepoBuildState;
}): RepoBuildStateComparison {
  const before = params.before;
  const after = params.after;
  const afterKeys = new Set(after.diagnostics.map(diagnosticKey));
  const beforeErrorKeys = new Set(
    (before?.diagnostics ?? [])
      .filter((diag) => diag.severity === "error")
      .map(diagnosticKey),
  );
  const afterErrorKeys = new Set(
    after.diagnostics
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

  const reasonCodes: RepoBuildStateComparisonReason[] = [];
  if (!before) reasonCodes.push("no_before_state");
  if (clearedErrorCount > 0) reasonCodes.push("errors_cleared");
  if (remainingErrorCount > 0 || after.summary.errorCount > 0) {
    reasonCodes.push("errors_remaining");
  }
  if (newErrorCount > 0) reasonCodes.push("new_errors_introduced");
  if (after.summary.warningCount > 0) reasonCodes.push("warnings_remaining");
  if (after.summary.failedCheckIds.length > 0) {
    reasonCodes.push("checks_still_failing");
  }

  return repoBuildStateComparisonSchema.parse({
    beforeErrorCount: before?.summary.errorCount ?? 0,
    afterErrorCount: after.summary.errorCount,
    clearedErrorCount,
    newErrorCount,
    remainingErrorCount,
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
