/**
 * Verify phase: runner + onFailure + repair caps (S12-FLOW / S12-REPAIR).
 */

import type { VerificationBaselineSnapshot } from "../../contracts/verify/VerificationBaselineSnapshot";
import {
  verificationOutcomeSchema,
  type VerificationOutcome,
} from "../../contracts/verify/VerificationOutcome";
import type { VerificationRequest } from "../../contracts/verify/VerificationRequest";
import type { RuntimeVerificationRunnerPort } from "../../ports/RuntimeVerificationRunnerPort";
import { compareAgainstBaseline } from "./CompareAgainstBaseline";
import { runWithVerifyWall } from "./RunWithVerifyWall";
import { selectVerificationPolicy } from "./SelectVerificationPolicy";
import type { VerificationBudgets } from "./VerificationBudgets";

export interface RunVerificationPhaseInput {
  runId: string;
  route?: string;
  runVerify?: boolean;
  verification?: SelectVerificationPolicyInput["verification"];
  changedPaths?: readonly string[];
  workspaceRoot?: string;
  runner?: RuntimeVerificationRunnerPort;
  /** Prior repair passes already spent this finish. */
  repairPass?: number;
  baselineSnapshot?: VerificationBaselineSnapshot;
  /** Post-change signatures for baseline compare (host/runner). */
  afterSignatures?: readonly string[];
  budgets?: Partial<VerificationBudgets>;
  catalogProjects?: SelectVerificationPolicyInput["catalogProjects"];
  allowHeavy?: boolean;
  /** Progress while slow checks run (S12-TIME). */
  onProgress?: (event: {
    phase: "verify_started" | "verify_timed_out" | "verify_finished";
    runId: string;
    checks?: readonly string[];
    elapsedMs?: number;
  }) => void;
}

type SelectVerificationPolicyInput = Parameters<
  typeof selectVerificationPolicy
>[0];

export interface RunVerificationPhaseResult {
  outcome: VerificationOutcome;
  request?: VerificationRequest;
  /** When true, caller should re-enter turn loop for repair. */
  returnToLoop: boolean;
  /** When true, after_verify continue_required gate should fire. */
  suspendContinue: boolean;
}

/**
 * Select policy → invoke runner → map onFailure / repair budget.
 */
export async function runVerificationPhase(
  input: RunVerificationPhaseInput,
): Promise<RunVerificationPhaseResult> {
  const policy = selectVerificationPolicy({
    runId: input.runId,
    route: input.route,
    runVerify: input.runVerify,
    verification: input.verification,
    changedPaths: input.changedPaths,
    workspaceRoot: input.workspaceRoot,
    repairPass: input.repairPass,
    baselineSnapshot: input.baselineSnapshot,
    budgets: input.budgets,
    catalogProjects: input.catalogProjects,
    allowHeavy: input.allowHeavy,
  });

  if (policy.skip || !policy.request) {
    return {
      outcome: verificationOutcomeSchema.parse({
        schemaVersion: 1,
        status: "skipped",
        reasonCodes: policy.reasonCodes,
      }),
      returnToLoop: false,
      suspendContinue: false,
    };
  }

  const request = policy.request;
  const runner = input.runner;
  if (!runner) {
    return {
      outcome: verificationOutcomeSchema.parse({
        schemaVersion: 1,
        status: request.allowUnavailable ? "unavailable" : "failed",
        checksRun: request.checks,
        onFailure: request.onFailure,
        repairPass: request.repairPass,
        reasonCodes: [
          ...policy.reasonCodes,
          "verification_runner_not_wired",
        ],
      }),
      request,
      returnToLoop: false,
      suspendContinue: false,
    };
  }

  const wallMs = request.budgets?.verifyWallMs ?? 120_000;
  input.onProgress?.({
    phase: "verify_started",
    runId: input.runId,
    checks: request.checks,
  });

  const raced = await runWithVerifyWall({
    wallMs,
    work: runner.run(request),
  });

  if (raced.timedOut) {
    input.onProgress?.({
      phase: "verify_timed_out",
      runId: input.runId,
      checks: request.checks,
      elapsedMs: raced.elapsedMs,
    });
    return {
      outcome: verificationOutcomeSchema.parse({
        schemaVersion: 1,
        status: request.allowUnavailable ? "unavailable" : "failed",
        checksRun: request.checks,
        onFailure: request.onFailure,
        repairPass: request.repairPass,
        reasonCodes: [
          ...policy.reasonCodes,
          "verification_wall_timed_out",
          `verification_wall_ms_${wallMs}`,
        ],
      }),
      request,
      returnToLoop: false,
      suspendContinue: false,
    };
  }

  const raw = raced.value;
  const compared = compareAgainstBaseline({
    baseline: request.baselineSnapshot,
    afterSignatures: input.afterSignatures,
    changedPaths: input.changedPaths ?? request.changedPaths,
  });
  input.onProgress?.({
    phase: "verify_finished",
    runId: input.runId,
    checks: request.checks,
  });
  return interpretRunnerOutcome({
    request,
    policyCodes: [...policy.reasonCodes, ...compared.reasonCodes],
    raw,
    newRegressions: compared.newRegressions,
    baselineLeftovers: compared.baselineLeftovers,
  });
}

function interpretRunnerOutcome(params: {
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
}): RunVerificationPhaseResult {
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

  // failed (runner or new regressions vs baseline)
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

  // report (default)
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
