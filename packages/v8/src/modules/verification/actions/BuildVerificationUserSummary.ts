import {
  DEFAULT_SUMMARY_CHARS,
  DEFAULT_SUMMARY_DIAGNOSTICS,
} from "../defaults";
import type {
  RepoBuildState,
  VerificationDiagnostic,
  VerificationRecord,
} from "../contracts";
import { diagnosticIdentityKey } from "./diagnosticIdentity";
import { packDiagnosticsForModel } from "./NormalizeDiagnostics";

/**
 * Deterministic user-facing verification summary. Counts and lists come from
 * the record, not from model judgment. An optional LLM narrative may wrap
 * this text; it must not replace it.
 *
 * Compare-only posture: when the ask landed and this change introduced no new
 * errors, remaining pre-existing issues are reported as **optional** — the
 * user can opt in; we do not treat them as the failed job.
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
  const editsApplied = (record.changedFiles?.length ?? 0) > 0;
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
        editsApplied
          ? "Verification passed. The edits were kept."
          : "Verification passed. No workspace edits were recorded for this change.",
        cleared > 0 ? `Cleared ${cleared} error(s).` : "No remaining errors.",
        newCount > 0 ? `Unexpected new errors: ${newCount}.` : undefined,
        remaining > 0
          ? formatOptionalLeftoverOffer({ remaining, sample: buckets.remaining })
          : undefined,
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

  // No mutations landed — never claim edits were kept (critic/grant blocks).
  if (!editsApplied) {
    return clip(
      [
        "No workspace edits were applied. Verification baseline is unchanged.",
        `Baseline: ${beforeErrors} error(s).`,
        remaining > 0
          ? formatOptionalLeftoverOffer({ remaining, sample: buckets.remaining })
          : undefined,
        record.retry
          ? `Say "fix the remaining verification errors" to continue from this snapshot.`
          : undefined,
      ]
        .filter((line): line is string => Boolean(line))
        .join("\n"),
    );
  }

  // Ask done, no new regressions — remaining are optional leftovers.
  if (newCount === 0 && remaining > 0) {
    return clip(
      [
        "The requested edits were kept. Verification found no new regressions from this change.",
        `Before: ${beforeErrors} error(s). After: ${afterErrors} error(s). Cleared: ${cleared}.`,
        formatOptionalLeftoverOffer({ remaining, sample: buckets.remaining }),
      ].join("\n"),
    );
  }

  if (newCount === 0) {
    return clip(
      [
        "The requested edits were kept. Verification found no new regressions from this change.",
        cleared > 0 ? `Cleared ${cleared} error(s).` : undefined,
      ]
        .filter((line): line is string => Boolean(line))
        .join(" "),
    );
  }

  const lines = [
    "Verification found new issues from this change. I kept the edits.",
    "",
    `Before: ${beforeErrors} error(s)`,
    `After: ${afterErrors} error(s)`,
    `Cleared: ${cleared}`,
    `New (this change): ${newCount}`,
    ...formatDiagnosticLines("New", buckets.introduced),
    remaining > 0 ? `Pre-existing (optional): ${remaining}` : undefined,
    ...formatDiagnosticLines("Pre-existing", buckets.remaining),
    failedChecks.length > 0
      ? `Failed checks: ${failedChecks.join(", ")}`
      : undefined,
    "",
    record.retry
      ? `Say "fix the remaining verification errors" to continue repairing new or leftover issues from this snapshot.`
      : undefined,
  ].filter((line): line is string => line !== undefined);

  return clip(lines.join("\n"));
}

/**
 * Optional leftover blurb for accept / compare-clean paths.
 * Prefixed so hosts can append it under the main ask answer.
 */
export function formatOptionalLeftoverOffer(params: {
  remaining: number;
  sample?: readonly VerificationDiagnostic[];
}): string {
  if (params.remaining <= 0) {
    return "";
  }
  const sampleLines = formatDiagnosticLines(
    "Optional",
    (params.sample ?? []).slice(0, DEFAULT_SUMMARY_DIAGNOSTICS),
  );
  return [
    `I also see ${params.remaining} pre-existing issue(s) that were not part of this ask (optional).`,
    ...sampleLines,
    `I can fix those next if you want — say "fix the remaining verification errors".`,
  ].join("\n");
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
  const packed = packDiagnosticsForModel({
    diagnostics,
    maxTotal: DEFAULT_SUMMARY_DIAGNOSTICS,
    errorsOnly: true,
  });
  const lines = packed.diagnostics.map((diagnostic) => {
    const line = diagnostic.startLine ? `:${diagnostic.startLine}` : "";
    const code = diagnostic.code ? ` ${diagnostic.code}` : "";
    return `  ${label}: ${diagnostic.path}${line}${code} ${diagnostic.message.slice(0, 200)}`;
  });
  if (packed.omittedCount > 0) {
    lines.push(`  ${label}: …and ${packed.omittedCount} more omitted`);
  }
  return lines;
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function clip(text: string): string {
  return text.trim().slice(0, DEFAULT_SUMMARY_CHARS);
}
