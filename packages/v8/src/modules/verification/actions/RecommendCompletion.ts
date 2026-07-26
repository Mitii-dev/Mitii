import type { VerificationRequirement } from "../../decision-policy";

import type {
  VerificationCheckKind,
  VerificationCheckResult,
  VerificationReasonCode,
  VerificationStatus,
} from "../contracts";

export interface CompletionRecommendation {
  status: VerificationStatus;
  reasonCodes: VerificationReasonCode[];
}

/** Decision evidence kinds → check kinds that can satisfy them. */
const EVIDENCE_TO_CHECK: Record<string, VerificationCheckKind[]> = {
  diagnostics: ["diagnostics", "syntax"],
  typecheck: ["typecheck"],
  lint: ["lint", "format"],
  tests: ["test"],
  build: ["build"],
  diff_review: ["diff_review"],
};

/**
 * Evidence-only completion gate. Failed, skipped, unavailable, timed-out, or
 * cancelled checks MUST NOT become verified_success.
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

  const runnable = params.checks.filter(
    (check) => check.outcome !== "skipped",
  );

  if (runnable.length === 0) {
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

  if (runnable.some((check) => check.outcome === "cancelled")) {
    return {
      status: "cancelled",
      reasonCodes: ["cancelled"],
    };
  }

  if (runnable.some((check) => check.outcome === "failed")) {
    return {
      status: "verification_failed",
      reasonCodes: ["checks_failed"],
    };
  }

  if (runnable.some((check) => check.outcome === "timed_out")) {
    return {
      status: "verification_failed",
      reasonCodes: ["checks_timed_out"],
    };
  }

  const unavailable = runnable.filter(
    (check) => check.outcome === "unavailable",
  );
  const passed = runnable.filter((check) => check.outcome === "passed");
  const passedKinds = new Set(passed.map((check) => check.kind));
  const requiredCovered = requiredEvidenceCovered(
    params.verification.minimumEvidence,
    passedKinds,
  );

  if (unavailable.length > 0 || !requiredCovered) {
    const reasonCodes: VerificationReasonCode[] = requiredCovered
      ? ["checks_unavailable", "missing_tool_degraded"]
      : ["no_applicable_checks", "checks_unavailable"];
    if (unavailable.length > 0) {
      reasonCodes.push("missing_tool_degraded");
    }
    return params.verification.allowUnavailable
      ? {
          status: "implemented_unverified",
          reasonCodes: [...new Set(reasonCodes)],
        }
      : {
          status: "blocked",
          reasonCodes: [...new Set(reasonCodes)],
        };
  }

  const reasonCodes: VerificationReasonCode[] = ["checks_passed"];
  if (params.staleStateRisk) {
    reasonCodes.push("stale_state_risk");
  }
  if (runnable.some((check) => check.kind === "diff_review")) {
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

function requiredEvidenceCovered(
  minimumEvidence: readonly string[],
  passedKinds: ReadonlySet<VerificationCheckKind>,
): boolean {
  if (minimumEvidence.length === 0) {
    return passedKinds.size > 0;
  }
  return minimumEvidence.every((evidence) => {
    const kinds = EVIDENCE_TO_CHECK[evidence] ?? [];
    return kinds.some((kind) => passedKinds.has(kind));
  });
}
