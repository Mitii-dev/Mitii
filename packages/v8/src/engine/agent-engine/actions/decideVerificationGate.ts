import type { VerificationResult } from "../../../modules/verification";

/**
 * Pure decision for how Agent Engine should treat a Verification result.
 *
 * Segregates accept vs reject so mutation commit/rollback is not driven by
 * ad-hoc if-chains that conflate "checks failed" with "checks unavailable".
 *
 * Accept (commit mutations):
 * - verification not required / no changed files
 * - verified_success
 * - implemented_unverified (work done; evidence incomplete — keep changes)
 * - verification infrastructure missing AND allowUnavailable
 *
 * Reject (eligible for repair only when repairable):
 * - verification_failed → repairable (model can fix the change)
 * - blocked / cancelled / infrastructure missing → not repairable
 */
export type VerificationGateDecision =
  | {
      action: "accept";
      acceptKind:
        | "verified_success"
        | "implemented_unverified"
        | "skipped_not_required"
        | "unavailable_allowed";
    }
  | {
      action: "reject";
      repairable: boolean;
      rejectKind:
        | "verification_failed"
        | "blocked"
        | "cancelled"
        | "infrastructure_unavailable";
      error: { code: string; message: string };
      verification?: VerificationResult;
    };

export function decideVerificationGate(params: {
  verificationRequired: boolean;
  allowUnavailable: boolean;
  changedFileCount: number;
  canVerify: boolean;
  missingInfrastructure?: readonly string[];
  verification?: VerificationResult;
}): VerificationGateDecision {
  if (!params.verificationRequired || params.changedFileCount === 0) {
    return { action: "accept", acceptKind: "skipped_not_required" };
  }

  if (!params.canVerify) {
    if (params.allowUnavailable) {
      return { action: "accept", acceptKind: "unavailable_allowed" };
    }
    const missing =
      params.missingInfrastructure && params.missingInfrastructure.length > 0
        ? params.missingInfrastructure.join(", ")
        : "verification port or pinned state";
    return {
      action: "reject",
      repairable: false,
      rejectKind: "infrastructure_unavailable",
      error: {
        code: "verification_failed",
        message: `Verification is required but unavailable (missing ${missing}).`,
      },
    };
  }

  const verification = params.verification;
  if (!verification) {
    return {
      action: "reject",
      repairable: false,
      rejectKind: "infrastructure_unavailable",
      error: {
        code: "verification_failed",
        message: "Verification is required but produced no result.",
      },
    };
  }

  switch (verification.status) {
    case "verified_success":
      return { action: "accept", acceptKind: "verified_success" };
    case "implemented_unverified":
      // Architecture: "implementation completed but verification unavailable".
      // Keep mutations; do not roll back a successful edit for missing scripts.
      return { action: "accept", acceptKind: "implemented_unverified" };
    case "verification_failed":
      return {
        action: "reject",
        repairable: true,
        rejectKind: "verification_failed",
        verification,
        error: {
          code: "verification_failed",
          message: `Verification did not succeed (status: ${verification.status}).`,
        },
      };
    case "blocked":
      return {
        action: "reject",
        // State/grant blockers are not fixed by rewriting application code.
        repairable: false,
        rejectKind: "blocked",
        verification,
        error: {
          code: "verification_failed",
          message: `Verification did not succeed (status: ${verification.status}).`,
        },
      };
    case "cancelled":
      return {
        action: "reject",
        repairable: false,
        rejectKind: "cancelled",
        verification,
        error: {
          code: "verification_failed",
          message: `Verification did not succeed (status: ${verification.status}).`,
        },
      };
    default: {
      const exhaustive: never = verification.status;
      return {
        action: "reject",
        repairable: false,
        rejectKind: "blocked",
        verification,
        error: {
          code: "verification_failed",
          message: `Verification returned unrecognized status: ${String(exhaustive)}.`,
        },
      };
    }
  }
}
