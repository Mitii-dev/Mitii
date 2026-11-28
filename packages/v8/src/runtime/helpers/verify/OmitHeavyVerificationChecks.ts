/**
 * S12-HEAVY — never auto-select browser/e2e/emulator checks.
 */

import { BROWSER_E2E_TEST_PATTERN } from "../../../modules/verification";

const EMULATOR_PATTERN =
  /(?:^|[\s:_-])(?:emulator|simulator|android.?avd|ios.?sim)(?:$|[\s:_-])/i;

export interface OmitHeavyVerificationChecksInput {
  /** Candidate check ids / labels / argv haystacks. */
  candidates: readonly string[];
  /** Explicit user/policy opt-in for heavy suites. */
  allowHeavy?: boolean;
}

export interface OmitHeavyVerificationChecksResult {
  allowed: string[];
  omitted: Array<{ candidate: string; reason: string }>;
  reasonCodes: string[];
}

/**
 * Drop browser/e2e/emulator candidates unless `allowHeavy` is true.
 */
export function omitHeavyVerificationChecks(
  input: OmitHeavyVerificationChecksInput,
): OmitHeavyVerificationChecksResult {
  if (input.allowHeavy) {
    return {
      allowed: [...input.candidates],
      omitted: [],
      reasonCodes: ["verify_heavy_explicitly_allowed"],
    };
  }

  const allowed: string[] = [];
  const omitted: Array<{ candidate: string; reason: string }> = [];

  for (const candidate of input.candidates) {
    if (BROWSER_E2E_TEST_PATTERN.test(candidate)) {
      omitted.push({
        candidate,
        reason: "browser_e2e_gated",
      });
      continue;
    }
    if (EMULATOR_PATTERN.test(candidate)) {
      omitted.push({
        candidate,
        reason: "emulator_gated",
      });
      continue;
    }
    allowed.push(candidate);
  }

  return {
    allowed,
    omitted,
    reasonCodes:
      omitted.length > 0
        ? ["verify_heavy_omitted", ...omitted.map((o) => `omit_${o.reason}`)]
        : ["verify_heavy_none"],
  };
}

/** True when a script/check token implies heavy side effects. */
export function isHeavyVerificationCandidate(candidate: string): boolean {
  return (
    BROWSER_E2E_TEST_PATTERN.test(candidate) ||
    EMULATOR_PATTERN.test(candidate)
  );
}
