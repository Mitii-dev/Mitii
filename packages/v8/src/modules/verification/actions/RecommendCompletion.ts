import type { VerificationRequirement } from "../../decision-policy";

import type {
  VerificationReasonCode,
  VerificationStatus,
} from "../contracts";
import type { VerificationCheckResult } from "../contracts";
import { assessEvidenceCoverage } from "../internal/evidencePolicy";

export interface CompletionRecommendation {
  status: VerificationStatus;
  reasonCodes: VerificationReasonCode[];
}

/**
 * Evidence-only completion gate.
 *
 * Outcome segregation (do not conflate these):
 * - verified_success: required evidence covered by passed checks; no defects
 * - verification_failed: a check failed or timed out (defect in the change)
 * - implemented_unverified: no defects, but required evidence could not be
 *   obtained (missing scripts/tools) or state is stale
 * - blocked: hard infrastructure/policy blocker (unavailable pinned state,
 *   or zero runnable checks when policy forbids unverified completion)
 * - cancelled: run aborted
 *
 * Missing project scripts or tools are NOT defects and MUST NOT become
 * `blocked` merely because `allowUnavailable` is false. That flag only
 * gates the empty-check / no-applicable-checks case.
 */
export function recommendCompletion(params: {
  verification: VerificationRequirement;
  checks: readonly VerificationCheckResult[];
  cancelled: boolean;
  staleStateRisk: boolean;
  stateUnavailable: boolean;
}): CompletionRecommendation {
  if (params.stateUnavailable) {
    return {
      status: "blocked",
      reasonCodes: ["state_unavailable"],
    };
  }

  if (!params.verification.required) {
    return {
      status: "verified_success",
      reasonCodes: ["verification_not_required"],
    };
  }

  if (params.cancelled) {
    return {
      status: "cancelled",
      reasonCodes: ["cancelled"],
    };
  }

  const coverage = assessEvidenceCoverage({
    minimumEvidence: params.verification.minimumEvidence,
    checks: params.checks,
  });

  if (coverage.hasCancelled) {
    return {
      status: "cancelled",
      reasonCodes: ["cancelled"],
    };
  }

  // Defects in the change — never treat as success or "unavailable".
  if (coverage.hasFailed) {
    return {
      status: "verification_failed",
      reasonCodes: ["checks_failed"],
    };
  }
  if (coverage.hasTimedOut) {
    return {
      status: "verification_failed",
      reasonCodes: ["checks_timed_out"],
    };
  }

  // Literally nothing ran — infrastructure gap, not a code defect.
  if (coverage.runnable.length === 0) {
    return params.verification.allowUnavailable
      ? {
          status: "implemented_unverified",
          reasonCodes: ["no_applicable_checks", "checks_unavailable"],
        }
      : {
          status: "blocked",
          reasonCodes: ["no_applicable_checks", "grant_insufficient"],
        };
  }

  // Checks ran without failing, but required evidence is incomplete
  // (e.g. package.json has no test/typecheck scripts). Keep the work as
  // implemented_unverified — rolling it back is incorrect.
  if (!coverage.requiredCovered) {
    const reasonCodes: VerificationReasonCode[] =
      coverage.passed.length > 0
        ? ["checks_unavailable"]
        : ["no_applicable_checks", "checks_unavailable"];
    if (coverage.unavailable.length > 0) {
      reasonCodes.push("missing_tool_degraded");
    }
    return {
      status: "implemented_unverified",
      reasonCodes: [...new Set(reasonCodes)],
    };
  }

  const reasonCodes: VerificationReasonCode[] = ["checks_passed"];
  if (params.staleStateRisk) {
    reasonCodes.push("stale_state_risk");
  }
  if (coverage.passedKinds.has("diff_review")) {
    reasonCodes.push("diff_reviewed");
  }

  // Stale state with required verification: pass checks but do not claim clean success.
  if (params.staleStateRisk) {
    return {
      status: "implemented_unverified",
      reasonCodes,
    };
  }

  return {
    status: "verified_success",
    reasonCodes,
  };
}
