import type {
  RepoBuildStateComparison,
  VerificationDiagnostic,
  VerificationResult,
} from "../../../modules/verification";
import { packDiagnosticsForModel } from "../../../modules/verification";

import { diagnosticSourceLineKey } from "./loadDiagnosticSourceLines";

const DEFAULT_MAX_DIAGNOSTICS = 16;
const DEFAULT_MESSAGE_CHARS = 180;

const HARD_DENIED_SEGMENTS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  "out",
]);

/**
 * Compact one-shot repair instruction. Persisted verification records stay
 * outside the transcript; this is only the top remaining errors the model
 * needs for a single repair pass.
 *
 * Prefer diagnostics under the user ask / changed files / active batch.
 * Never steer repair into node_modules or other hard-denied trees.
 */
export function buildVerificationRepairPrompt(params: {
  verification?: VerificationResult;
  comparison?: RepoBuildStateComparison;
  changedFiles: readonly string[];
  maxDiagnostics?: number;
  /**
   * Optional source line text keyed by `diagnosticSourceLineKey(path, line)`.
   * Loaded by the engine before packaging — never stored on the durable record.
   */
  sourceLines?: ReadonlyMap<string, string>;
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
  /** Trusted seed / ask paths — prefer these over unrelated residuals. */
  askScopePaths?: readonly string[];
  userPrompt?: string;
}): string {
  const maxDiagnostics =
    params.activeBatch !== undefined
      ? 8
      : (params.maxDiagnostics ?? DEFAULT_MAX_DIAGNOSTICS);

  const scopePaths = collectAskScopePaths(params);
  const rawDiagnostics = params.verification?.diagnostics ?? [];
  const scoped = filterDiagnosticsToAskScope(rawDiagnostics, scopePaths);
  const hasAskScope = scopePaths.some(
    (path) => path.trim().length > 0 && path.trim() !== ".",
  );
  // Never fall back to the full raw dump when ask/changed scope is known —
  // that is what steers repair into vitest/tsconfig/import thrash.
  const usable =
    scoped.length > 0
      ? scoped
      : hasAskScope
        ? []
        : rawDiagnostics.filter((item) => !isHardDeniedDiagnosticPath(item.path));

  const packed = packDiagnosticsForModel({
    diagnostics: usable,
    maxTotal: maxDiagnostics,
    errorsOnly: true,
  });
  const diagnostics = packed.diagnostics.flatMap((diagnostic) =>
    formatDiagnosticRepairLines(diagnostic, params.sourceLines),
  );

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

  const omitFooter =
    packed.omittedCount > 0
      ? `…and ${packed.omittedCount} more error(s) omitted; fix the listed items first.`
      : undefined;

  const askLock =
    params.userPrompt?.trim()
      ? `User ask (do not replace with package cleanup): ${params.userPrompt.trim().slice(0, 240)}`
      : undefined;

  const compareLock =
    params.comparison !== undefined
      ? `Compare-only repair: fix NEW regressions from this change (${params.comparison.newErrorCount} new). Do not chase ${params.comparison.remainingErrorCount} pre-existing remaining error(s) unless the user ask named them.`
      : "Compare-only repair: fix only new regressions from this change on ask/changed paths. Pre-existing leftovers are optional — do not expand into them.";

  const errorBlock =
    diagnostics.length > 0
      ? [
          "New ask-scoped errors (fix these exact items; do not rediscover):",
          ...diagnostics,
          omitFooter,
        ]
          .filter((line): line is string => Boolean(line))
          .join("\n")
      : hasAskScope
        ? [
            "No new ask-scoped diagnostics remain on the changed/seed paths.",
            "Do not expand into unrelated vitest, tsconfig, mass import cleanup, or pre-existing leftovers.",
            "If the user ask is already satisfied on the changed files, stop — do not invent new repairs.",
            changed,
          ]
            .filter((line): line is string => Boolean(line))
            .join("\n")
        : failedCheckLines.length > 0
          ? `Failed checks (no structured diagnostics; fix from these summaries):\n${failedCheckLines.join("\n")}`
          : "No structured diagnostics were attached; inspect only the changed files named above and fix new regressions only.";

  return [
    "Verification found issues after the change. Call apply_patch only for NEW ask-scoped regressions below.",
    "Fix every listed new error this turn when possible. Group by code/message; do not stop after the first diagnostic.",
    "Do not write a report. Do not call glob_files, search_files, list_directory, directory_tree, document_symbol, or run_readonly_command.",
    "read_file is allowed only for paths named in the error list (or the active batch write/mustRead paths). Then patch.",
    "Do not introduce new TypeScript errors. Prefer renaming calls to match existing page/adapter APIs over inventing methods.",
    "Never edit node_modules, .git, dist/build/out, or unrelated vitest/tsconfig unless the user ask names them.",
    askLock,
    compareLock,
    batch,
    counts,
    changed,
    errorBlock,
  ]
    .filter((line): line is string => Boolean(line))
    .join("\n");
}

export function filterDiagnosticsToAskScope(
  diagnostics: readonly VerificationDiagnostic[],
  scopePaths: readonly string[],
): VerificationDiagnostic[] {
  if (diagnostics.length === 0) return [];
  const scopes = scopePaths
    .map(normalizePath)
    .filter((path) => path.length > 0 && path !== ".");
  const withoutDenied = diagnostics.filter(
    (item) => !isHardDeniedDiagnosticPath(item.path),
  );
  if (scopes.length === 0) {
    return [...withoutDenied];
  }
  const matching = withoutDenied.filter((item) =>
    isPathInAskScope(item.path, scopes),
  );
  return matching;
}

function collectAskScopePaths(params: {
  changedFiles: readonly string[];
  askScopePaths?: readonly string[];
  activeBatch?: {
    write?: readonly string[];
    mustRead?: readonly string[];
    affected?: readonly string[];
  };
}): string[] {
  const out: string[] = [];
  for (const path of params.askScopePaths ?? []) {
    if (path.trim()) out.push(path);
  }
  for (const path of params.changedFiles) {
    if (path.trim()) out.push(path);
  }
  const batch = params.activeBatch;
  if (batch) {
    for (const path of [
      ...(batch.write ?? []),
      ...(batch.mustRead ?? []),
      ...(batch.affected ?? []),
    ]) {
      if (path.trim()) out.push(path);
    }
  }
  return out;
}

function isPathInAskScope(path: string, scopes: readonly string[]): boolean {
  const normalized = normalizePath(path);
  if (!normalized || isHardDeniedDiagnosticPath(normalized)) {
    return false;
  }
  return scopes.some((scope) => {
    if (scope === ".") return true;
    return (
      normalized === scope ||
      normalized.startsWith(`${scope}/`) ||
      scope.startsWith(`${normalized}/`)
    );
  });
}

function isHardDeniedDiagnosticPath(path: string): boolean {
  const normalized = normalizePath(path);
  if (
    normalized
      .split("/")
      .filter(Boolean)
      .some((segment) => HARD_DENIED_SEGMENTS.has(segment))
  ) {
    return true;
  }
  // Harness frames often prefix noise before the real path
  // (e.g. "❯ EventEmitter.onMessage ../../node_modules/vitest/...").
  return /(?:^|\/| )node_modules(?:\/|$)/i.test(normalized);
}

function normalizePath(value: string): string {
  return value
    .trim()
    .replace(/\\/g, "/")
    .replace(/^\.\//, "")
    .replace(/\/+$/, "");
}

function formatDiagnosticRepairLines(
  diagnostic: VerificationDiagnostic,
  sourceLines: ReadonlyMap<string, string> | undefined,
): string[] {
  const line = diagnostic.startLine ? `:${diagnostic.startLine}` : "";
  const message = diagnostic.message.replace(/\s+/g, " ").trim().slice(
    0,
    DEFAULT_MESSAGE_CHARS,
  );
  const header = `- ${diagnostic.path}${line} ${message}`;
  if (!diagnostic.startLine || !sourceLines) {
    return [header];
  }
  const snippet = sourceLines.get(
    diagnosticSourceLineKey(diagnostic.path, diagnostic.startLine),
  );
  if (!snippet) {
    return [header];
  }
  return [header, `  | ${snippet}`];
}
