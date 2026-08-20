import type { VerificationRequirement } from "../../decision-policy";

import type {
  VerificationCheckKind,
  VerificationChangeScope,
} from "../contracts";
import { DEFAULT_MAX_CHECKS } from "../defaults";
import { checkKindsForEvidence } from "../internal/evidencePolicy";
import { CHECK_KIND_PRIORITY } from "../policy";
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
 * only run when Decision Policy asked for `tests` evidence.
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
