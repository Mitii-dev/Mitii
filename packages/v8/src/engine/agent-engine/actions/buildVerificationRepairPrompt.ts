import type {
  RepoBuildStateComparison,
  VerificationResult,
} from "../../../modules/verification";

const DEFAULT_MAX_DIAGNOSTICS = 8;
const DEFAULT_MESSAGE_CHARS = 180;

/**
 * Compact one-shot repair instruction. Persisted verification records stay
 * outside the transcript; this is only the top remaining errors the model
 * needs for a single repair pass.
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
}): string {
  const maxDiagnostics = params.maxDiagnostics ?? DEFAULT_MAX_DIAGNOSTICS;
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
    budget !== undefined
      ? `apply_patch hard limits this turn: at most ${budget.preferredBatchSize} files, ${budget.maxUniqueFilesPerCall} unique files, ${budget.maxPatchesPerCall} patches. Remaining errors go on the next turn.`
      : "Prefer minimal patches. Then stop so verification can run again.";

  return [
    "Verification failed. Call apply_patch now for the next remaining-error batch.",
    "Do not write a report or re-read the whole repository. Remaining errors go on later turns.",
    batch,
    counts,
    changed,
    diagnostics.length > 0
      ? `Remaining errors:\n${diagnostics.join("\n")}`
      : "No structured diagnostics were attached; inspect the changed files and fix the verification failure.",
  ]
    .filter((line): line is string => Boolean(line))
    .join("\n");
}
