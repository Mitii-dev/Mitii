import type { RouteBodyPlan } from "../../helpers/routes";
import type { RuntimeDecisionSketch } from "./5-Decide";
import type { StepContext } from "./StepContext";

export interface VerifyFinishSketch {
  ranVerify: boolean;
  invalidated: boolean;
  finished: boolean;
  reasonCodes: string[];
}

/**
 * Step 11 — verify-the-change + finish shell (§12).
 * Full VerificationRunner still module/engine-owned; here we gate on routeBody
 * and record invalidation when the mutate journal advanced after a prior verify.
 */
export function verifyFinish(ctx: StepContext): VerifyFinishSketch {
  const decision = ctx.store.getSlice<RuntimeDecisionSketch>("decision");
  const body = decision?.routeBody as RouteBodyPlan | undefined;

  if (!body?.runVerify) {
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
