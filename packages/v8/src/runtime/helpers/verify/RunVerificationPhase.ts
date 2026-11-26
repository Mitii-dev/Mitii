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
import { interpretRunnerOutcome } from "./InterpretRunnerOutcome";
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
