import type { DiscoveryTarget } from "../../../modules/planning";
import type { ProjectDescriptor } from "../../../modules/repository-state";
import type { RepoBuildState } from "../../../modules/verification";

import {
  isSafeRelativePlanningPath,
  normalizePlanningPath,
  uniqueStrings,
} from "./PlanningPathUtils";
import { isPlanningFollowUp } from "./IsPlanningFollowUp";


const MAX_PRIOR_ASSISTANT_CHARS = 24_000;
const MAX_PLANNING_QUERY_CHARS = 12_000;

/** Multi-item improvement / implementation lists in prior assistant guidance. */
const MULTI_ITEM_GUIDANCE =
  /(?:^|\n)\s*(?:#{1,3}\s+)?(?:suggested\s+improvements|improvements?\s*\/\s*gaps|what\s+to\s+improve|implementation\s+plan|todos?)(?:\b|:)/i;
const MULTI_BULLET_ROWS =
  /(?:^|\n)\s*(?:[-*]|\d+[.)])\s+\S.+(?:\n\s*(?:[-*]|\d+[.)])\s+\S.+){2,}/m;
const MULTI_TABLE_ROWS = /\|.+\|(?:\n\|.+\|){3,}/;

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
      isPlanningFollowUp(currentQuery, conversation));

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
 * Prior assistant guidance that enumerates multiple implementation items
 * (bullets, tables, improvement sections) — not a single-file tweak.
 */
export function looksLikeMultiItemPlanGuidance(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length < 120) {
    return false;
  }
  if (MULTI_ITEM_GUIDANCE.test(trimmed)) {
    return true;
  }
  if (MULTI_BULLET_ROWS.test(trimmed)) {
    return true;
  }
  return MULTI_TABLE_ROWS.test(trimmed);
}

function clipForPlanning(text: string, maxChars: number): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxChars) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(0, maxChars - 1))}…`;
}

