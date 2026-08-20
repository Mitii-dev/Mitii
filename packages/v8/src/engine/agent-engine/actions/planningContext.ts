import type { DiscoveryTarget } from "../../../modules/planning";
import type { ProjectDescriptor } from "../../../modules/repository-state";
import type { RepoBuildState } from "../../../modules/verification";

export function inferDiscoveryTargetKind(
  kind: string,
): DiscoveryTarget["kind"] {
  if (
    kind === "file" ||
    kind === "folder" ||
    kind === "symbol" ||
    kind === "test" ||
    kind === "config"
  ) {
    return kind;
  }
  return "unknown";
}

export function buildScopedRepoMapForPlanning(
  contextPaths: readonly string[],
): { entries: Array<{ path: string; kind?: string; note?: string }> } | undefined {
  const entries = uniqueStrings(contextPaths.map(normalizePlanningPath))
    .filter((path) => isSafeRelativePlanningPath(path))
    .slice(0, 80)
    .map((path) => ({
      path,
      kind: path.includes(".") ? "file" : "folder",
    }));
  return entries.length > 0 ? { entries } : undefined;
}

export function toPlanningBuildEvidence(state: RepoBuildState): {
  phase: "before";
  summary: string;
  diagnostics?: RepoBuildState["diagnostics"];
  failedChecks?: string[];
} {
  const failedChecks = state.checks
    .filter((check) => state.summary.failedCheckIds.includes(check.checkId))
    .map((check) => check.label || check.checkId)
    .slice(0, 32);
  const topDiagnostics = state.diagnostics.slice(0, 200);
  const summaryParts = [
    `${state.summary.errorCount} error(s)`,
    `${state.summary.warningCount} warning(s)`,
    state.scope.projectIds.length > 0
      ? `projects: ${state.scope.projectIds.slice(0, 8).join(", ")}`
      : undefined,
    failedChecks.length > 0
      ? `failed checks: ${failedChecks.slice(0, 8).join(", ")}`
      : undefined,
  ].filter((part): part is string => Boolean(part));

  return {
    phase: "before",
    summary: summaryParts.join("; ").slice(0, 4_000),
    diagnostics: topDiagnostics.length > 0 ? topDiagnostics : undefined,
    failedChecks: failedChecks.length > 0 ? failedChecks : undefined,
  };
}

export function normalizePlanningPath(value: string): string {
  return value
    .trim()
    .replace(/^@+/, "")
    .replace(/\\/g, "/")
    .replace(/^\.\//, "")
    .replace(/\/+$/, "") || ".";
}

export function isSafeRelativePlanningPath(path: string): boolean {
  return (
    path.length > 0 &&
    !path.startsWith("/") &&
    !path.startsWith("~") &&
    !path.includes("..") &&
    !/^[A-Za-z]:\//.test(path)
  );
}

export function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

export function inferLanguageFromPaths(paths: readonly string[]): ProjectDescriptor["primaryLanguageId"] {
  const joined = paths.join(" ").toLowerCase();
  if (/\.(ts|tsx|js|jsx|mjs|cjs)\b/.test(joined)) return "typescript";
  if (/\.py\b/.test(joined)) return "python";
  if (/\.go\b/.test(joined)) return "go";
  if (/\.rs\b/.test(joined)) return "rust";
  if (/\.(java|kt)\b/.test(joined)) return "java";
  if (/\.cs\b/.test(joined)) return "csharp";
  if (/\.(c|cc|cpp|h|hpp)\b/.test(joined)) return "cpp";
  if (/\.rb\b/.test(joined)) return "ruby";
  if (/\.php\b/.test(joined)) return "php";
  if (/\.swift\b/.test(joined)) return "swift";
  return "typescript";
}

/**
 * Prefer a substantive prior user ask when the live turn is a short follow-up
 * ("fix it") so plan objectives stay grounded.
 */
export function buildPlanningQuery(
  currentQuery: string,
  conversation: readonly { role: string; content: string }[],
): string {
  const current = currentQuery.trim().replace(/\s+/g, " ");
  const priorUser = [...conversation]
    .reverse()
    .find(
      (entry) => entry.role === "user" && entry.content.trim().length >= 24,
    )
    ?.content.trim()
    .replace(/\s+/g, " ");

  if (
    priorUser &&
    (current.length < 24 ||
      /^(?:please\s+|can\s+you\s+|could\s+you\s+)?(?:fix|update|change|check|do|handle|implement)\s+(?:it|this|that)\b/i.test(
        current,
      ))
  ) {
    return `${priorUser}\n\nFollow-up: ${current}`.slice(0, 1_000);
  }

  return current.slice(0, 1_000);
}
