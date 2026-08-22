import type { DiscoveryTarget } from "../../../modules/planning";
import type { ProjectDescriptor } from "../../../modules/repository-state";
import type { RepoBuildState } from "../../../modules/verification";

import {
  rankPathsForShapedDiscovery,
  resolveShapedDiscoveryProfile,
} from "./shapedDiscovery";

const FILE_LIKE_PATH =
  /(?:^|[\s`"'(=,[])((?:[\w.-]+\/)+[\w.-]+\.[\w]{1,16})\b/g;

const FOLLOW_UP_PLAN_QUERY =
  /^(?:please\s+|can\s+you\s+|could\s+you\s+)?(?:fix|update|change|check|do|handle|implement)\s+(?:it|this|that)\b/i;

/** "plan the above / plan that / for implementation / based on above" */
const FOLLOW_UP_PLAN_REFERENCE =
  /(?:\bplan\b.{0,40}\b(?:above|that|this|it)\b|\b(?:above|prior|previous)\b.{0,40}\b(?:plan|implement)|(?:for|to)\s+implement(?:ation)?\b|\bbased\s+on\s+(?:the\s+)?(?:above|prior|previous)\b)/i;

const MAX_PRIOR_ASSISTANT_CHARS = 1_200;
const MAX_PLANNING_QUERY_CHARS = 1_500;
const MAX_PRIOR_PATH_HINTS = 8;

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
  return (
    value
      .trim()
      .replace(/^@+/, "")
      .replace(/\\/g, "/")
      .replace(/^\.\//, "")
      .replace(/\/+$/, "") || "."
  );
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

export function inferLanguageFromPaths(
  paths: readonly string[],
): ProjectDescriptor["primaryLanguageId"] {
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
 * Prefer a substantive prior user ask (and last assistant grounding) when the
 * live turn is a short follow-up ("fix it", "plan the above for implementation")
 * so plan objectives stay grounded.
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

  const shouldMergePrior =
    Boolean(priorUser) &&
    (current.length < 24 ||
      FOLLOW_UP_PLAN_QUERY.test(current) ||
      FOLLOW_UP_PLAN_REFERENCE.test(current));

  if (!shouldMergePrior || !priorUser) {
    return current.slice(0, MAX_PLANNING_QUERY_CHARS);
  }

  const priorAssistant = [...conversation]
    .reverse()
    .find(
      (entry) =>
        entry.role === "assistant" && entry.content.trim().length >= 40,
    )
    ?.content.trim();

  const parts = [
    priorUser,
    "",
    `Follow-up: ${current}`,
  ];
  if (priorAssistant) {
    parts.push(
      "",
      "Prior assistant guidance (for planning grounding only):",
      clipForPlanning(priorAssistant, MAX_PRIOR_ASSISTANT_CHARS),
    );
  }
  return parts.join("\n").slice(0, MAX_PLANNING_QUERY_CHARS);
}

/**
 * True when the live turn continues a prior ask ("plan the above", "fix it",
 * short plan-after-ask). Requires prior conversation — cold plan prompts like
 * "plan for implementing headless tests" are not follow-ups.
 */
export function isPlanningFollowUp(
  currentQuery: string,
  conversation: readonly { role: string; content: string }[],
): boolean {
  const hasPriorTurns = conversation.some(
    (entry) =>
      (entry.role === "user" || entry.role === "assistant") &&
      entry.content.trim().length > 0,
  );
  if (!hasPriorTurns) {
    return false;
  }

  const current = currentQuery.trim().replace(/\s+/g, " ");
  if (
    FOLLOW_UP_PLAN_QUERY.test(current) ||
    FOLLOW_UP_PLAN_REFERENCE.test(current)
  ) {
    return true;
  }

  return (
    current.length < 80 &&
    /\bplan\b.{0,24}\b(?:above|that|this|it)\b/i.test(current)
  );
}

/**
 * File-like paths mentioned in prior turns. Used to seed discovery and
 * strategy short-circuits — hints only, not grants.
 */
export function extractPriorPathHints(
  conversation: readonly { role: string; content: string }[],
): string[] {
  const recent = conversation
    .filter(
      (entry) =>
        (entry.role === "user" || entry.role === "assistant") &&
        entry.content.trim().length > 0,
    )
    .slice(-6);
  const found: string[] = [];
  for (const entry of recent) {
    for (const path of extractFileLikePaths(entry.content)) {
      found.push(path);
    }
  }
  return uniqueStrings(found.map(normalizePlanningPath))
    .filter((path) => isSafeRelativePlanningPath(path) && path.includes("."))
    .slice(0, MAX_PRIOR_PATH_HINTS);
}

/**
 * Preferred discovery / strategy paths: explicit file targets, context paths,
 * then prior conversation path hints.
 */
export function collectPreferredPlanningPaths(params: {
  evidenceTargets?: readonly { kind: string; value: string; explicit: boolean }[];
  contextPaths?: readonly string[];
  priorPathHints?: readonly string[];
  query?: string;
  max?: number;
}): string[] {
  const max = params.max ?? MAX_PRIOR_PATH_HINTS;
  const explicit = (params.evidenceTargets ?? [])
    .filter(
      (target) =>
        target.explicit &&
        (target.kind === "file" ||
          target.kind === "config" ||
          target.kind === "test" ||
          /\.\w{1,16}$/.test(target.value)),
    )
    .map((target) => normalizePlanningPath(target.value));
  const context = (params.contextPaths ?? []).map(normalizePlanningPath);
  const prior = (params.priorPathHints ?? []).map(normalizePlanningPath);
  const merged = uniqueStrings([...explicit, ...context, ...prior]).filter(
    (path) =>
      isSafeRelativePlanningPath(path) &&
      path !== "." &&
      (path.includes(".") || path.includes("/")),
  );
  const profile = params.query
    ? resolveShapedDiscoveryProfile(params.query)
    : undefined;
  const ranked = profile
    ? rankPathsForShapedDiscovery(profile, merged)
    : merged;
  return ranked.slice(0, max);
}

function extractFileLikePaths(text: string): string[] {
  const paths: string[] = [];
  const re = new RegExp(FILE_LIKE_PATH.source, "g");
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    const path = match[1]?.trim();
    if (path) paths.push(path);
  }
  // Bare or nested paths in backticks / code spans.
  const backtick = /`((?:[\w.@/-]+\/)*[\w.-]+\.[\w]{1,16})`/g;
  while ((match = backtick.exec(text)) !== null) {
    const path = match[1]?.trim();
    if (path) paths.push(path);
  }
  // Plain-text filenames / relative paths with common source extensions.
  const plain =
    /\b((?:[\w.-]+\/)*[\w.-]+\.(?:ts|tsx|js|jsx|mjs|cjs|py|go|rs|java|kt|cs|json|ya?ml|toml|md|css|scss))\b/gi;
  while ((match = plain.exec(text)) !== null) {
    const path = match[1]?.trim();
    if (path) paths.push(path);
  }
  return paths;
}

function clipForPlanning(text: string, maxChars: number): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxChars) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(0, maxChars - 1))}…`;
}
