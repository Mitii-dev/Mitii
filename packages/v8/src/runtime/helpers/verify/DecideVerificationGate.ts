import type {
  RepoBuildStateComparison,
  VerificationResult,
} from "../../../modules/verification";

import type { VerificationGateDecision } from "./DecideVerificationGateTypes";
import {
  behaviorDefectMessage,
  diagnosticErrorMessage,
  hasInScopeActionableRepairTarget,
  isSoftUnavailableBlock,
} from "./DecideVerificationGateInternals";
import { isUserGoalComplete } from "./IsUserGoalComplete";

export type { VerificationGateDecision } from "./DecideVerificationGateTypes";

export function resolveFailedVerificationTerminalStatus(params: {
  changedFileCount: number;
  rejectKind: Extract<
    VerificationGateDecision,
    { action: "reject" }
  >["rejectKind"];
}): "failed" | "completed" {
  if (params.rejectKind === "no_mutation_performed") {
    return "failed";
  }
  if (params.changedFileCount > 0) {
    return "failed";
  }
  return "completed";
}

export function decideVerificationGate(params: {
  verificationRequired: boolean;
  allowUnavailable: boolean;
  changedFileCount: number;
  mutationRequired?: boolean;
  canVerify: boolean;
  missingInfrastructure?: readonly string[];
  verification?: VerificationResult;
  comparison?: RepoBuildStateComparison;
  /** Changed / seed paths — used to ignore unrelated package noise. */
  askScopePaths?: readonly string[];
  changedFiles?: readonly string[];
  /** Decision-policy minimum evidence kinds (e.g. includes `tests`). */
  minimumEvidence?: readonly string[];
}): VerificationGateDecision {
  if (params.mutationRequired && params.changedFileCount === 0) {
    return {
      action: "reject",
      repairable: false,
      rejectKind: "no_mutation_performed",
      error: {
        code: "no_mutation_performed",
        message:
          "The task required workspace edits, but the model completed without changing any files.",
      },
    };
  }

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

  const goalParams = {
    verification,
    comparison: params.comparison,
    askScopePaths: params.askScopePaths,
    changedFiles: params.changedFiles,
    minimumEvidence: params.minimumEvidence,
  };

  switch (verification.status) {
    case "verified_success":
      return { action: "accept", acceptKind: "verified_success" };
    case "implemented_unverified":
      if (isUserGoalComplete(goalParams)) {
        return { action: "accept", acceptKind: "implemented_unverified" };
      }
      if (hasInScopeActionableRepairTarget(goalParams)) {
        return {
          action: "reject",
          repairable: true,
          rejectKind: "verification_failed",
          verification,
          error: {
            code: "verification_failed",
            message: behaviorDefectMessage(goalParams) ??
              diagnosticErrorMessage(params.comparison),
          },
        };
      }
      // Architecture: "implementation completed but verification unavailable".
      // Keep mutations; do not roll back a successful edit for missing scripts.
      return { action: "accept", acceptKind: "implemented_unverified" };
    case "verification_failed":
      if (isUserGoalComplete(goalParams)) {
        return { action: "accept", acceptKind: "implemented_unverified" };
      }
      // repair only for NEW∩IN_SCOPE∩ACTIONABLE (or ask-scoped /
      // failed authoritative evidence the model can still address).
      return {
        action: "reject",
        repairable: hasInScopeActionableRepairTarget(goalParams),
        rejectKind: "verification_failed",
        verification,
        error: {
          code: "verification_failed",
          message: `Verification did not succeed (status: ${verification.status}).`,
        },
      };
    case "blocked":
      if (isSoftUnavailableBlock(verification, params.allowUnavailable)) {
        return { action: "accept", acceptKind: "implemented_unverified" };
      }
      return {
        action: "reject",
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

/**
 * Repair opens only for in-scope actionable work:
 * - NEW in-scope actionable compare delta, or
 * - ask-scoped source defects, or
 * - failed project-local compile without soft-accept (suite/compile may
 *   fail without parseable in-scope rows).
 *
 * Pre-existing workspace-root check failures with no NEW in-scope errors and
 * no ask-scoped defect are leftovers — do not open unbounded repair.
 */
