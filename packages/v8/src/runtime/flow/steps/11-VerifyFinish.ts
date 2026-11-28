import type { RouteBodyPlan } from "../../helpers/routes";
import type { VerificationBaselineSnapshot } from "../../contracts/verify/VerificationBaselineSnapshot";
import type { VerificationOutcome } from "../../contracts/verify/VerificationOutcome";
import { runVerificationPhase } from "../../helpers/verify/RunVerificationPhase";
import { evaluateGates } from "../../helpers/gates";
import type { RuntimeVerificationRunnerPort } from "../../ports/RuntimeVerificationRunnerPort";
import type { RuntimeDecisionSketch } from "./5-Decide";
import type { StepContext } from "./StepContext";

export interface VerifyFinishSketch {
  ranVerify: boolean;
  invalidated: boolean;
  finished: boolean;
  returnToLoop?: boolean;
  suspendContinue?: boolean;
  outcome?: VerificationOutcome;
  reasonCodes: string[];
}

/**
 * Step 11 — verify-the-change + finish (S12-FLOW).
 * Sync shell stamps policy fingerprint; async `verifyFinishAsync` runs the phase.
 */
export function verifyFinish(ctx: StepContext): VerifyFinishSketch {
  const decision = ctx.store.getSlice<RuntimeDecisionSketch>("decision");
  const body = decision?.routeBody as RouteBodyPlan | undefined;

  if (!body?.runVerify && !decision?.verification?.required) {
    const sketch: VerifyFinishSketch = {
      ranVerify: false,
      invalidated: false,
      finished: true,
      reasonCodes: ["verify_skipped_by_route"],
    };
    ctx.store.setSlice("verifyFinish", sketch);
    return sketch;
  }

  const prior = ctx.store.getSlice<{ fingerprint?: string }>("lastVerify");
  const journalLen =
    (ctx.store.getSlice<unknown[]>("toolJournal") ?? []).length;
  const fingerprint = `j${journalLen}`;
  const invalidated =
    prior?.fingerprint != null && prior.fingerprint !== fingerprint;

  const sketch: VerifyFinishSketch = {
    ranVerify: true,
    invalidated,
    finished: true,
    reasonCodes: [
      "verify_shell",
      ...(invalidated ? ["verify_invalidated_after_mutate"] : []),
      "finish_shell",
    ],
  };
  ctx.store.setSlice("lastVerify", { fingerprint });
  ctx.store.setSlice("verifyFinish", sketch);
  return sketch;
}

/**
 * Full verify phase with runner + onFailure/repair (S12).
 */
export async function verifyFinishAsync(
  ctx: StepContext,
  opts?: {
    runId?: string;
    runner?: RuntimeVerificationRunnerPort;
    repairPass?: number;
    changedPaths?: readonly string[];
    workspaceRoot?: string;
    /** Post-change diagnostic fingerprints for baseline compare. */
    afterSignatures?: readonly string[];
    budgets?: {
      verifyWallMs?: number;
      perCheckTimeoutMs?: number;
      maxChecks?: number;
    };
    onProgress?: (event: {
      phase: "verify_started" | "verify_timed_out" | "verify_finished";
      runId: string;
      checks?: readonly string[];
      elapsedMs?: number;
    }) => void;
  },
): Promise<VerifyFinishSketch> {
  const decision = ctx.store.getSlice<RuntimeDecisionSketch>("decision");
  const body = decision?.routeBody as RouteBodyPlan | undefined;
  const runId = opts?.runId ?? "run";
  const baseline = ctx.store.getSlice<VerificationBaselineSnapshot>(
    "verifyBaseline",
  );

  const shell = verifyFinish(ctx);
  if (!shell.ranVerify) {
    return shell;
  }

  const phase = await runVerificationPhase({
    runId,
    route: decision?.route,
    runVerify: body?.runVerify === true,
    verification: decision?.verification,
    changedPaths: opts?.changedPaths,
    workspaceRoot: opts?.workspaceRoot,
    runner: opts?.runner ?? ctx.deps?.verification,
    repairPass: opts?.repairPass,
    baselineSnapshot: baseline,
    afterSignatures: opts?.afterSignatures,
    budgets: opts?.budgets,
    onProgress: opts?.onProgress,
    catalogProjects: ctx.input.catalog?.projects,
  });

  let suspendContinue = phase.suspendContinue;
  if (phase.suspendContinue) {
    const verdict = evaluateGates("after_verify", {
      runId,
      verificationRepairCapped: true,
    });
    if (verdict?.action === "suspend") {
      suspendContinue = true;
    }
  }

  const sketch: VerifyFinishSketch = {
    ranVerify: true,
    invalidated: shell.invalidated,
    finished: !phase.returnToLoop && !suspendContinue,
    returnToLoop: phase.returnToLoop,
    suspendContinue,
    outcome: phase.outcome,
    reasonCodes: [
      ...shell.reasonCodes,
      ...phase.outcome.reasonCodes,
      ...(suspendContinue ? ["verify_after_gate_continue"] : []),
    ],
  };
  ctx.store.setSlice("verifyFinish", sketch);
  return sketch;
}
