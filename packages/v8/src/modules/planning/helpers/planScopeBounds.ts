/**
 * Bound discovery preferred paths / working-set seeds to the chosen A/B/C scope.
 * Token rules are generic (tests / CI / packages) — not host- or repo-specific.
 */

import type { PlanScopeId } from "./planScopeChoice";
import { PLAN_SCOPE_DEFS } from "./planScopeChoice";

/** Path substrings that score for each scope (lowercase match). */
const SCOPE_PATH_TOKENS: Record<PlanScopeId, readonly string[]> = {
  a: [
    "test",
    "spec",
    "oracle",
    "fixture",
    "__tests__",
    "__bench__",
    "cases/",
    "e2e",
    "contract",
    "http",
    "auth",
    "negative",
    ".test.",
    ".spec.",
  ],
  b: [
    "ci",
    "workflow",
    ".github",
    "validate",
    "grade",
    "dry-run",
    "dryrun",
    "smoke",
    "corpus",
    "contributing",
    "docs/",
    "readme",
    "lint",
    "coverage",
  ],
  c: [
    "packages/",
    "apps/",
    "runner",
    "turbo",
    "pnpm-workspace",
    "workspace",
    "architecture",
    "schema",
    "dsl",
    "scoring",
    "harness",
    "monorepo",
  ],
};

export function scorePathForPlanScope(
  path: string,
  scopeId: PlanScopeId,
): number {
  const lower = path.replace(/\\/g, "/").toLowerCase();
  let score = 0;
  for (const token of SCOPE_PATH_TOKENS[scopeId]) {
    if (lower.includes(token)) {
      score += token.length >= 6 ? 2 : 1;
    }
  }
  return score;
}

/**
 * Keep paths that match the chosen scope. If none match, keep a small
 * fallback from the original list so discovery is not emptied.
 */
export function boundPreferredPathsForPlanScope(
  paths: readonly string[],
  scopeId: PlanScopeId,
  maxPaths = 6,
): string[] {
  const unique: string[] = [];
  const seen = new Set<string>();
  for (const path of paths) {
    const trimmed = path.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    unique.push(trimmed);
  }
  const scored = unique
    .map((path) => ({ path, score: scorePathForPlanScope(path, scopeId) }))
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));
  if (scored.length > 0) {
    return scored.slice(0, maxPaths).map((row) => row.path);
  }
  return unique.slice(0, Math.min(3, maxPaths));
}

/** System hint injected into the discovery pass when scope is locked. */
export function planScopeDiscoveryHint(scopeId: PlanScopeId): string {
  const def = PLAN_SCOPE_DEFS[scopeId];
  return (
    `Scope lock (phase ${def.letter}): focus discovery on ${def.label}. ` +
    `${def.detail} Prefer matching paths; defer other campaign scopes.`
  );
}

/** Compact process hint (PlanningInput.processHints ≤120 chars). */
export function planScopeProcessHint(scopeId: PlanScopeId): string {
  const def = PLAN_SCOPE_DEFS[scopeId];
  return `Scope lock ${def.letter}: ${def.label} only.`;
}

/** Optional search seeds when shaped profile is weak after a scope pick. */
export function planScopeSearchQueries(scopeId: PlanScopeId): string[] {
  switch (scopeId) {
    case "a":
      return ["oracle test", "contract spec", "negative path"];
    case "b":
      return ["validate ci", "workflow grade", "dry-run smoke"];
    case "c":
      return ["runner scoring", "workspace package", "grading schema"];
    default:
      return [];
  }
}
