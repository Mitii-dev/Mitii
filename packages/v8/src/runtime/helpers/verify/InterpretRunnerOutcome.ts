/**
 * Map runner status + baseline deltas → VerificationOutcome / repair flags.
 */

import {
  verificationOutcomeSchema,
  type VerificationOutcome,
} from "../../contracts/verify/VerificationOutcome";
import type { VerificationRequest } from "../../contracts/verify/VerificationRequest";

export interface InterpretRunnerOutcomeResult {
  outcome: VerificationOutcome;
  request: VerificationRequest;
  returnToLoop: boolean;
  suspendContinue: boolean;
}

export function interpretRunnerOutcome(params: {
  request: VerificationRequest;
  policyCodes: readonly string[];
  raw: {
    status: "passed" | "failed" | "skipped" | "unavailable";
    reasonCodes: string[];
    checksRun?: string[];
    summary?: string;
  };
  newRegressions: string[];
  baselineLeftovers: string[];
}): InterpretRunnerOutcomeResult {
  const { request, policyCodes, raw, newRegressions, baselineLeftovers } =
    params;
  const codes = [...policyCodes, ...raw.reasonCodes];
  const baselineFields = {
    newRegressions,
    baselineLeftovers,
  };

  // Baseline leftovers alone never force fail — only new regressions do.
  const effectiveStatus =
    raw.status === "passed" && newRegressions.length > 0
      ? ("failed" as const)
      : raw.status;

  if (effectiveStatus === "passed" || effectiveStatus === "skipped") {
    return {
      outcome: verificationOutcomeSchema.parse({
        schemaVersion: 1,
        status: effectiveStatus,
        checksRun: raw.checksRun ?? request.checks,
        onFailure: request.onFailure,
        repairPass: request.repairPass,
        summary: raw.summary,
        ...baselineFields,
        reasonCodes: codes,
      }),
      request,
      returnToLoop: false,
      suspendContinue: false,
    };
  }

  if (effectiveStatus === "unavailable") {
    return {
      outcome: verificationOutcomeSchema.parse({
        schemaVersion: 1,
        status: request.allowUnavailable ? "unavailable" : "failed",
        checksRun: raw.checksRun ?? request.checks,
        onFailure: request.onFailure,
        repairPass: request.repairPass,
        summary: raw.summary,
        ...baselineFields,
        reasonCodes: [...codes, "verification_unavailable"],
      }),
      request,
      returnToLoop: false,
      suspendContinue: false,
    };
  }

  const onFailure = request.onFailure;
  const nextPass = request.repairPass + 1;

  if (onFailure === "retry" && nextPass <= request.maxRepairPasses) {
    return {
      outcome: verificationOutcomeSchema.parse({
        schemaVersion: 1,
        status: "repair_requested",
        checksRun: raw.checksRun ?? request.checks,
        onFailure,
        repairPass: nextPass,
        shouldReturnToLoop: true,
        summary: raw.summary,
        ...baselineFields,
        reasonCodes: [...codes, "verification_repair_requested"],
      }),
      request,
      returnToLoop: true,
      suspendContinue: false,
    };
  }

  if (onFailure === "retry" && nextPass > request.maxRepairPasses) {
    return {
      outcome: verificationOutcomeSchema.parse({
        schemaVersion: 1,
        status: "repair_capped",
        checksRun: raw.checksRun ?? request.checks,
        onFailure,
        repairPass: request.repairPass,
        shouldSuspendContinue: true,
        summary: raw.summary,
        ...baselineFields,
        reasonCodes: [...codes, "verification_repair_capped"],
      }),
      request,
      returnToLoop: false,
      suspendContinue: true,
    };
  }

  if (onFailure === "block") {
    return {
      outcome: verificationOutcomeSchema.parse({
        schemaVersion: 1,
        status: "blocked",
        checksRun: raw.checksRun ?? request.checks,
        onFailure,
        repairPass: request.repairPass,
        summary: raw.summary,
        ...baselineFields,
        reasonCodes: [...codes, "verification_blocked_on_failure"],
      }),
      request,
      returnToLoop: false,
      suspendContinue: false,
    };
  }

  return {
    outcome: verificationOutcomeSchema.parse({
      schemaVersion: 1,
      status: "failed",
      checksRun: raw.checksRun ?? request.checks,
      onFailure: "report",
      repairPass: request.repairPass,
      summary: raw.summary,
      ...baselineFields,
      reasonCodes: [...codes, "verification_failed_reported"],
    }),
    request,
    returnToLoop: false,
    suspendContinue: false,
  };
}
