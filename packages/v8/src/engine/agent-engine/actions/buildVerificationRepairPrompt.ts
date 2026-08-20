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

  return [
    "Verification failed. Call apply_patch now for the next remaining-error batch.",
    "Group remaining errors by code/message and fix each class across its files this turn. Do not stop after the first diagnostic.",
    "Do not write a report or re-read the whole repository. Remaining error classes go on later turns.",
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
