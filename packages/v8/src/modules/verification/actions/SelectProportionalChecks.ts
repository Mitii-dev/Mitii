import type { VerificationRequirement } from "../../decision-policy";

import type {
  VerificationCheckKind,
  VerificationChangeScope,
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
 */
export function selectProportionalChecks(params: {
  candidates: readonly DiscoveredCheckCandidate[];
  verification: VerificationRequirement;
  changeScope: VerificationChangeScope;
  maxChecks?: number;
}): SelectProportionalChecksResult {
  const requiredKinds = new Set<VerificationCheckKind>();
  for (const evidence of params.verification.minimumEvidence) {
    for (const kind of checkKindsForEvidence(evidence)) {
      requiredKinds.add(kind);
    }
  }

  const byPriority = [...params.candidates].sort((a, b) => {
    const aRequired = requiredKinds.has(a.kind) ? 0 : 1;
    const bRequired = requiredKinds.has(b.kind) ? 0 : 1;
    if (aRequired !== bRequired) return aRequired - bRequired;
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

  // Localized: one check per kind; broader scopes may keep multiple projects.
  const selected: DiscoveredCheckCandidate[] = [];
  const seenKinds = new Set<VerificationCheckKind>();
  const omitted: DiscoveredCheckCandidate[] = [];

  for (const candidate of byPriority) {
    if (candidate.kind === "test" && !requiredKinds.has("test")) {
      omitted.push(candidate);
      continue;
    }
    if (candidate.kind === "test" && isBrowserE2eCandidate(candidate)) {
      omitted.push(candidate);
      continue;
    }
    if (selected.length >= (params.maxChecks ?? DEFAULT_MAX_CHECKS)) {
      omitted.push(candidate);
      continue;
    }
    if (
      (params.changeScope === "localized" || params.changeScope === "module") &&
      seenKinds.has(candidate.kind) &&
      !requiredKinds.has(candidate.kind)
    ) {
      omitted.push(candidate);
      continue;
    }
    selected.push(candidate);
    seenKinds.add(candidate.kind);
  }

  return { selected, omitted };
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
