/**
 * Phase 1 execution-reliability terminals for Verification finish.
 *
 * Hard invariants (engine-owned; no discovery reopen):
 * - Gate accept → ACCEPTED → STOP (no Continue / repair / rediscover)
 * - Repair exhausted → STOP / REPORT (no verification_repair_capped Continue)
 *
 * Budgets are decision boundaries, not permission to consume more wall time.
 */

export type VerificationFinishPhase =
  | "verifying"
  | "repairing"
  | "accepted"
  | "repair_exhausted"
  | "failed";

/**
 * After `decideVerificationGate` returns accept, never offer Continue walls
 * (incomplete_checklist, etc.). Checklist leftovers are reported in the
 * answer; they must not reopen a model loop.
 */
export function shouldSuspendContinueAfterVerificationAccept(): boolean {
  return false;
}

/**
 * After repair attempts are capped / stalled / out of budget, never suspend
 * for another autonomous pass. Durable retry records remain for an explicit
 * user "fix remaining" ask.
 */
export function shouldSuspendContinueAfterRepairExhausted(): boolean {
  return false;
}

/**
 * Illegal phase transitions for post-verify orchestration.
 * Returns true when `to` must not follow `from`.
 */
export function isIllegalVerificationPhaseTransition(
  from: VerificationFinishPhase,
  to: VerificationFinishPhase,
): boolean {
  if (from === "accepted") {
    return to === "repairing" || to === "verifying";
  }
  if (from === "repair_exhausted") {
    return to === "repairing" || to === "verifying";
  }
  return false;
}
