import type { VerificationRequirement } from "../../decision-policy";

import type {
  VerificationDiagnostic,
  VerificationReasonCode,
  VerificationStatus,
} from "../contracts";
import type { VerificationCheckResult } from "../contracts";
import { assessEvidenceCoverage } from "../internal/evidencePolicy";
import { assessTaskRelevantEvidence } from "./AssessTaskRelevantEvidence";

export interface CompletionRecommendation {
  status: VerificationStatus;
  reasonCodes: VerificationReasonCode[];
}

/**
 * Evidence-only completion gate.
 *
 * Outcome segregation (do not conflate these):
 * - verified_success: required evidence covered by passed checks; no defects
 * - verification_failed: a check failed or timed out with ask-scoped defects
 * - implemented_unverified: no ask-scoped defects, but required evidence could
 *   not be obtained, state is stale, OR task-relevant compile passed with only
 *   harness / phantom / workspace-root residuals
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
  /** Normalized diagnostics — used to separate harness noise from defects. */
  diagnostics?: readonly VerificationDiagnostic[];
  changedFiles?: readonly string[];
  askScopePaths?: readonly string[];
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

  // Defects vs residual noise — task-relevant compile can soft-accept.
  if (coverage.hasFailed || coverage.hasTimedOut) {
    const assessment = assessTaskRelevantEvidence({
      verification: params.verification,
      checks: params.checks,
      diagnostics: params.diagnostics,
      changedFiles: params.changedFiles,
      askScopePaths: params.askScopePaths,
    });
    if (assessment.shouldAccept) {
      return {
        status: "implemented_unverified",
        reasonCodes: assessment.reasonCodes,
      };
    }
    return {
      status: "verification_failed",
      reasonCodes: coverage.hasTimedOut
        ? ["checks_timed_out"]
        : ["checks_failed"],
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
