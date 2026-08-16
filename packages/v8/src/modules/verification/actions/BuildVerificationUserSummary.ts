import {
  DEFAULT_SUMMARY_CHARS,
  DEFAULT_SUMMARY_DIAGNOSTICS,
} from "../defaults";
import type {
  RepoBuildState,
  VerificationDiagnostic,
  VerificationRecord,
} from "../contracts";

/**
 * Deterministic user-facing verification summary. Counts and lists come from
 * the record, not from model judgment. An optional LLM narrative may wrap
 * this text; it must not replace it.
 */
export function buildVerificationUserSummary(
  record: VerificationRecord,
): string {
  const comparison = record.comparison;
  const beforeErrors = record.before?.summary.errorCount ?? 0;
  const afterErrors = record.after?.summary.errorCount ?? beforeErrors;
  const newCount = comparison?.newErrorCount ?? 0;
  const cleared = comparison?.clearedErrorCount ?? 0;
  const remaining = comparison?.remainingErrorCount ?? afterErrors;
  const buckets = classifyDiagnostics(record.before, record.after);
  const failedChecks = uniqueStrings([
    ...(record.after?.summary.failedCheckIds ?? []),
    ...(record.verification?.checks
      .filter(
        (check) =>
          check.outcome === "failed" ||
          check.outcome === "timed_out" ||
          check.outcome === "cancelled",
      )
      .map((check) => check.label || check.checkId) ?? []),
  ]).slice(0, 8);

  if (record.status === "passed") {
    return clip(
      [
        "Verification passed. The edits were kept.",
        cleared > 0 ? `Cleared ${cleared} error(s).` : "No remaining errors.",
        newCount > 0 ? `Unexpected new errors: ${newCount}.` : undefined,
      ]
        .filter((line): line is string => Boolean(line))
        .join(" "),
    );
  }

  if (record.status === "captured_before" || record.status === "cancelled") {
    return clip(
      [
        record.status === "cancelled"
          ? "Run stopped before after-change verification finished."
          : "Captured a before-change verification snapshot.",
        `Baseline: ${beforeErrors} error(s).`,
        record.retry
          ? `Say "fix the remaining verification errors" to continue from this snapshot.`
          : undefined,
      ]
        .filter((line): line is string => Boolean(line))
        .join(" "),
    );
  }

  const lines = [
    "Verification did not go clean. I kept the edits.",
    "",
    `Before: ${beforeErrors} error(s)`,
    `After: ${afterErrors} error(s)`,
    `Cleared: ${cleared}`,
    `New (this change): ${newCount}`,
    ...formatDiagnosticLines("New", buckets.introduced),
    `Remaining from before: ${remaining}`,
    ...formatDiagnosticLines("Remaining", buckets.remaining),
    failedChecks.length > 0
      ? `Failed checks: ${failedChecks.join(", ")}`
      : undefined,
    "",
    record.retry
      ? `Say "fix the remaining verification errors" to continue from this snapshot.`
      : undefined,
  ].filter((line): line is string => line !== undefined);

  return clip(lines.join("\n"));
}

function classifyDiagnostics(
  before: RepoBuildState | undefined,
  after: RepoBuildState | undefined,
): {
  introduced: VerificationDiagnostic[];
  remaining: VerificationDiagnostic[];
} {
  const beforeErrors = (before?.diagnostics ?? []).filter(
    (diagnostic) => diagnostic.severity === "error",
  );
  const afterErrors = (after?.diagnostics ?? []).filter(
    (diagnostic) => diagnostic.severity === "error",
  );
  const beforeKeys = new Set(beforeErrors.map(diagnosticIdentityKey));
  return {
    introduced: afterErrors.filter(
      (diagnostic) => !beforeKeys.has(diagnosticIdentityKey(diagnostic)),
    ),
    remaining: afterErrors.filter((diagnostic) =>
      beforeKeys.has(diagnosticIdentityKey(diagnostic)),
    ),
  };
}

function formatDiagnosticLines(
  label: string,
  diagnostics: readonly VerificationDiagnostic[],
): string[] {
  if (diagnostics.length === 0) {
    return [];
  }
  return diagnostics.slice(0, DEFAULT_SUMMARY_DIAGNOSTICS).map((diagnostic) => {
    const line = diagnostic.startLine ? `:${diagnostic.startLine}` : "";
    const code = diagnostic.code ? ` ${diagnostic.code}` : "";
    return `  ${label}: ${diagnostic.path}${line}${code} ${diagnostic.message.slice(0, 200)}`;
  });
}

function diagnosticIdentityKey(diagnostic: VerificationDiagnostic): string {
  return [
    diagnostic.path,
    diagnostic.severity,
    diagnostic.message,
    diagnostic.startLine ?? "",
    diagnostic.startColumn ?? "",
    diagnostic.source ?? "",
    diagnostic.code ?? "",
  ].join("\u0000");
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function clip(text: string): string {
  return text.trim().slice(0, DEFAULT_SUMMARY_CHARS);
}
