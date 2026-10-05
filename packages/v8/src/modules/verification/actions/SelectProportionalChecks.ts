import type { VerificationRequirement } from "../../decision-policy";

import type {
  VerificationCheckKind,
  VerificationChangeScope,
} from "../contracts";
import {
  NODE_MODULE_LOAD_EVIDENCE,
  SYNTAX_PORT_EVIDENCE,
} from "../contracts";
import { DEFAULT_MAX_CHECKS } from "../defaults";
import { checkKindsForEvidence } from "../internal/evidencePolicy";
import { BROWSER_E2E_TEST_PATTERN, CHECK_KIND_PRIORITY } from "../policy";
import type { DiscoveredCheckCandidate } from "../internal/discovery";

export interface SelectProportionalChecksResult {
  selected: DiscoveredCheckCandidate[];
  omitted: DiscoveredCheckCandidate[];
}

/**
 * Select the minimum useful checks: prefer required evidence kinds, then
 * proportional kinds for the change scope, capped by DEFAULT_MAX_CHECKS.
 *
 * `test` is never a bonus check. Browser/e2e scripts (wdio, desktop:test)
 * are never auto-selected — they need a live backend and can take hours.
 * Decision Policy `tests` evidence is satisfied by typecheck / unit scripts
 * instead (see EVIDENCE_TO_CHECK). Explicit "run the e2e suite" asks use
 * agent tools, not this proportional verifier.
 *
 * Package-scoped tests: when changed files live under `apps/` or `packages/`,
 * only run `test` checks for those touched packages. A vscode settings paste
 * must never drag in `packages/v8:test` unless `packages/v8` was edited and
 * tests evidence was required.
 */
export function selectProportionalChecks(params: {
  candidates: readonly DiscoveredCheckCandidate[];
  verification: VerificationRequirement;
  changeScope: VerificationChangeScope;
  maxChecks?: number;
  /** Workspace-relative paths mutated this turn (package-touch filter). */
  changedFiles?: readonly string[];
  /**
   * Soft script tokens from AGENTS.md / similar. Only reorders already
   * discovered candidates — never invents checks.
   */
  scriptHints?: readonly string[];
}): SelectProportionalChecksResult {
  const requiredKinds = new Set<VerificationCheckKind>();
  for (const evidence of params.verification.minimumEvidence) {
    for (const kind of checkKindsForEvidence(evidence)) {
      requiredKinds.add(kind);
    }
  }

  const changedFiles = params.changedFiles ?? [];
  const touchedPackageRoots = packageRootsFromChangedFiles(changedFiles);
  const scriptHints = new Set(
    (params.scriptHints ?? []).map((hint) => hint.toLowerCase()),
  );

  const byPriority = [...params.candidates].sort((a, b) => {
    const aRequired = requiredKinds.has(a.kind) ? 0 : 1;
    const bRequired = requiredKinds.has(b.kind) ? 0 : 1;
    if (aRequired !== bRequired) return aRequired - bRequired;
    const aHint = scriptHintRank(a, scriptHints);
    const bHint = scriptHintRank(b, scriptHints);
    if (aHint !== bHint) return aHint - bHint;
    // Prefer checks that touch the changed package over sibling packages.
    const aTouch = packageTouchRank(a, touchedPackageRoots);
    const bTouch = packageTouchRank(b, touchedPackageRoots);
    if (aTouch !== bTouch) return aTouch - bTouch;
    // Narrow scopes keep one syntax slot — prefer module-load over parse-only
    // before project-scope ranking (port:syntax is often workspace-global).
    if (a.kind === "syntax" && b.kind === "syntax") {
      const aSyntax = syntaxEvidenceRank(a);
      const bSyntax = syntaxEvidenceRank(b);
      if (aSyntax !== bSyntax) return aSyntax - bSyntax;
    }
    // Prefer package/inferred projects over workspace-root so localized
    // one-per-kind selection keeps the check that matches changed files.
    const aScope = projectScopeRank(a);
    const bScope = projectScopeRank(b);
    if (aScope !== bScope) return aScope - bScope;
    // Prefer non-browser tests ahead of e2e when both are candidates.
    if (a.kind === "test" && b.kind === "test") {
      const aE2e = isBrowserE2eCandidate(a) ? 1 : 0;
      const bE2e = isBrowserE2eCandidate(b) ? 1 : 0;
      if (aE2e !== bE2e) return aE2e - bE2e;
    }
    return (
      CHECK_KIND_PRIORITY.indexOf(a.kind) - CHECK_KIND_PRIORITY.indexOf(b.kind)
    );
  });

  // Localized/module: one check per kind even when that kind is required —
  // otherwise workspace-root + inferred typecheck both run and root noise
  // reopens verification repair after the package check already passed.
  const selected: DiscoveredCheckCandidate[] = [];
  const seenKinds = new Set<VerificationCheckKind>();
  const omitted: DiscoveredCheckCandidate[] = [];
  const narrowScope =
    params.changeScope === "localized" || params.changeScope === "module";

  const maxChecks = params.maxChecks ?? DEFAULT_MAX_CHECKS;

  for (const candidate of byPriority) {
    const isRequired = requiredKinds.has(candidate.kind);
    if (candidate.kind === "test" && !isRequired) {
      omitted.push(candidate);
      continue;
    }
    if (candidate.kind === "test" && isBrowserE2eCandidate(candidate)) {
      omitted.push(candidate);
      continue;
    }
    if (
      isUnrelatedPackageCandidate({
        candidate,
        touchedPackageRoots,
        kind: candidate.kind,
        narrowScope,
      })
    ) {
      omitted.push(candidate);
      continue;
    }
    if (narrowScope && seenKinds.has(candidate.kind)) {
      omitted.push(candidate);
      continue;
    }
    // Required evidence kinds are never truncated by the window budget.
    // Soft/bonus checks still respect maxChecks after required slots fill.
    if (!isRequired && selected.length >= maxChecks) {
      omitted.push(candidate);
      continue;
    }
    selected.push(candidate);
    seenKinds.add(candidate.kind);
  }

  return { selected, omitted };
}

/**
 * Lower rank is preferred within `syntax` kind. Module-load beats
 * tree-sitter / `node --check` so localized selection keeps the stronger gate.
 */
export function syntaxEvidenceRank(
  candidate: DiscoveredCheckCandidate,
): number {
  if (candidate.evidenceSource === NODE_MODULE_LOAD_EVIDENCE) return 0;
  if (candidate.evidenceSource === "changed-files:node_check") return 1;
  if (candidate.evidenceSource === SYNTAX_PORT_EVIDENCE) return 2;
  return 3;
}

export function isBrowserE2eCandidate(
  candidate: DiscoveredCheckCandidate,
): boolean {
  const haystack = [
    candidate.checkId,
    candidate.label,
    candidate.evidenceSource,
    ...(candidate.argv ?? []),
  ].join(" ");
  return BROWSER_E2E_TEST_PATTERN.test(haystack);
}

/**
 * Lower rank is preferred. Package/inferred checks beat workspace-root so a
 * single typecheck slot covers the changed package, not the monorepo root.
 */
export function projectScopeRank(candidate: DiscoveredCheckCandidate): number {
  const projectId = (candidate.projectId ?? "").replace(/\\/g, "/");
  const checkId = candidate.checkId.replace(/\\/g, "/");
  if (
    projectId.startsWith("inferred:") ||
    checkId.startsWith("inferred:") ||
    /^(apps|packages)\//.test(projectId)
  ) {
    return 0;
  }
  if (isWorkspaceRootCandidate(candidate)) {
    return 2;
  }
  return 1;
}

/**
 * Extract `apps/<name>` / `packages/<name>` roots from changed paths.
 */
export function packageRootsFromChangedFiles(
  changedFiles: readonly string[],
): string[] {
  const roots = new Set<string>();
  for (const file of changedFiles) {
    const root = packageRootFromPath(file);
    if (root) {
      roots.add(root);
    }
  }
  return [...roots];
}

/**
 * Project root for a candidate (`apps/vscode`, `packages/v8`, …), or
 * undefined for workspace-root / unknown.
 */
export function packageRootFromCandidate(
  candidate: DiscoveredCheckCandidate,
): string | undefined {
  const fromProject = packageRootFromPath(
    (candidate.projectId ?? "").replace(/^inferred:/, ""),
  );
  if (fromProject) {
    return fromProject;
  }
  const checkId = candidate.checkId.replace(/\\/g, "/").replace(/^inferred:/, "");
  return packageRootFromPath(checkId);
}

function packageRootFromPath(path: string): string | undefined {
  const normalized = path.replace(/\\/g, "/").replace(/^\.\//, "");
  const match = /^(apps|packages)\/[^/]+/.exec(normalized);
  return match?.[0];
}

/**
 * 0 = candidate package is among touched roots, 1 = unknown/workspace-root,
 * 2 = different apps/packages sibling (demote hard).
 */
function packageTouchRank(
  candidate: DiscoveredCheckCandidate,
  touchedPackageRoots: readonly string[],
): number {
  if (touchedPackageRoots.length === 0) {
    return 1;
  }
  const root = packageRootFromCandidate(candidate);
  if (!root) {
    return 1;
  }
  return touchedPackageRoots.some((touched) => packageRootsOverlap(root, touched))
    ? 0
    : 2;
}

/**
 * Drop checks that belong to a sibling package the change did not touch.
 *
 * - `test`: always package-scoped when any `apps/`/`packages/` file changed.
 * - Other kinds: same rule on narrow scopes so a vscode paste does not run
 *   `packages/v8` typecheck/lint just because that package has scripts.
 * - Workspace-root `test` is omitted when package-local changes exist.
 */
function isUnrelatedPackageCandidate(params: {
  candidate: DiscoveredCheckCandidate;
  touchedPackageRoots: readonly string[];
  kind: VerificationCheckKind;
  narrowScope: boolean;
}): boolean {
  const { candidate, touchedPackageRoots, kind, narrowScope } = params;
  if (touchedPackageRoots.length === 0) {
    return false;
  }

  const enforce =
    kind === "test" ||
    (narrowScope &&
      (kind === "typecheck" ||
        kind === "lint" ||
        kind === "format" ||
        kind === "build" ||
        kind === "syntax"));
  if (!enforce) {
    return false;
  }

  const root = packageRootFromCandidate(candidate);
  if (!root) {
    // Workspace-root / unknown: never run root tests for package-local edits.
    return kind === "test";
  }

  return !touchedPackageRoots.some((touched) =>
    packageRootsOverlap(root, touched),
  );
}

function packageRootsOverlap(a: string, b: string): boolean {
  return a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`);
}

/** 0 = matches an AGENTS.md script hint; 1 = no match. */
function scriptHintRank(
  candidate: DiscoveredCheckCandidate,
  hints: ReadonlySet<string>,
): number {
  if (hints.size === 0) {
    return 1;
  }
  const haystack = [
    candidate.checkId,
    candidate.label,
    candidate.evidenceSource,
    ...(candidate.argv ?? []),
  ]
    .join(" ")
    .toLowerCase();
  for (const hint of hints) {
    if (haystack.includes(hint)) {
      return 0;
    }
  }
  return 1;
}

function isWorkspaceRootCandidate(candidate: DiscoveredCheckCandidate): boolean {
  const projectId = (candidate.projectId ?? "").toLowerCase();
  if (
    projectId === "workspace-root" ||
    projectId === "root" ||
    projectId === "."
  ) {
    return true;
  }
  const checkId = candidate.checkId.toLowerCase();
  return (
    checkId.startsWith("workspace-root:") || checkId.startsWith("root:")
  );
}
