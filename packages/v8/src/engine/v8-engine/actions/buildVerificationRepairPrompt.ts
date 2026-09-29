import type {
  RepoBuildStateComparison,
  VerificationResult,
} from "../../../modules/verification";

const DEFAULT_MAX_DIAGNOSTICS = 16;
const DEFAULT_MESSAGE_CHARS = 180;

/**
 * Compact one-shot repair instruction. Persisted verification records stay
 * outside the transcript; this is only the top remaining errors the model
 * needs for a single repair pass.
 *
 * BillBuddy 00:48: keep this error-list driven — ban rediscovery so simple
 * adapter/signature mismatches do not burn 20+ minutes of reads.
 */
export function buildVerificationRepairPrompt(params: {
  verification?: VerificationResult;
  comparison?: RepoBuildStateComparison;
  changedFiles: readonly string[];
  maxDiagnostics?: number;
  mutationBudget?: {
    maxPatchesPerCall: number;
    maxUniqueFilesPerCall: number;
    preferredBatchSize: number;
  };
  /** Live checklist row to repair against instead of a wide error dump. */
  activeBatch?: {
    title: string;
    write?: readonly string[];
    mustRead?: readonly string[];
    affected?: readonly string[];
  };
}): string {
  const maxDiagnostics =
    params.activeBatch !== undefined ? 8 : (params.maxDiagnostics ?? DEFAULT_MAX_DIAGNOSTICS);
  const diagnostics = (params.verification?.diagnostics ?? [])
    .filter((diagnostic) => diagnostic.severity === "error")
    .slice(0, maxDiagnostics)
    .map((diagnostic) => {
      const line = diagnostic.startLine ? `:${diagnostic.startLine}` : "";
      const message = diagnostic.message.replace(/\s+/g, " ").trim().slice(
        0,
        DEFAULT_MESSAGE_CHARS,
      );
      return `- ${diagnostic.path}${line} ${message}`;
    });

  const failedCheckLines = (params.verification?.checks ?? [])
    .filter((check) => check.outcome === "failed")
    .slice(0, 6)
    .map((check) => `- ${check.checkId}: ${check.summary.replace(/\s+/g, " ").trim().slice(0, DEFAULT_MESSAGE_CHARS)}`);

  const comparison = params.comparison;
  const counts = comparison
    ? `After this change: ${comparison.afterErrorCount} error(s) (${comparison.newErrorCount} new, ${comparison.remainingErrorCount} remaining, ${comparison.clearedErrorCount} cleared).`
    : params.verification
      ? `Verification status: ${params.verification.status}.`
      : "Verification did not succeed.";

  const changed =
    params.changedFiles.length > 0
      ? `Changed files: ${params.changedFiles.slice(0, 12).join(", ")}.`
      : undefined;

  const budget = params.mutationBudget;
  const batch =
    params.activeBatch !== undefined
      ? "Use the live working-set active batch and mutation budget. Remaining errors below are from this verification pass."
      : budget !== undefined
        ? "Use the live working-set mutation budget. Remaining errors go on the next turn."
        : "Prefer minimal patches. Then stop so verification can run again.";

  const errorBlock =
    diagnostics.length > 0
      ? `Remaining errors (fix these exact items; do not rediscover):\n${diagnostics.join("\n")}`
      : failedCheckLines.length > 0
        ? `Failed checks (no structured diagnostics; fix from these summaries):\n${failedCheckLines.join("\n")}`
        : "No structured diagnostics were attached; inspect only the changed files named above and fix the verification failure.";

  return [
    "Verification failed. Call apply_patch now for the remaining-error batch below.",
    "Fix every listed error this turn when possible. Group by code/message; do not stop after the first diagnostic.",
    "Do not write a report. Do not call glob_files, search_files, list_directory, directory_tree, document_symbol, or run_readonly_command.",
    "read_file is allowed only for paths named in the error list (or the active batch write/mustRead paths). Then patch.",
    "Do not introduce new TypeScript errors. Prefer renaming calls to match existing page/adapter APIs over inventing methods.",
    batch,
    counts,
    changed,
    errorBlock,
  ]
    .filter((line): line is string => Boolean(line))
    .join("\n");
}
