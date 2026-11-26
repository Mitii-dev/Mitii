/**
 * Verify-phase time budgets (S12-TIME) — separate from mutate-loop budget.
 */

export interface VerificationBudgets {
  /** Total wall clock for the verify phase (ms). */
  verifyWallMs: number;
  /** Soft hint for each check (ms); runners may enforce. */
  perCheckTimeoutMs: number;
  /** Cap selected checks (modules/verification also owns this). */
  maxChecks: number;
}

export const DEFAULT_VERIFICATION_BUDGETS: VerificationBudgets = {
  verifyWallMs: 120_000,
  perCheckTimeoutMs: 30_000,
  maxChecks: 6,
};

export function resolveVerificationBudgets(
  partial?: Partial<VerificationBudgets>,
): VerificationBudgets {
  return {
    verifyWallMs: partial?.verifyWallMs ?? DEFAULT_VERIFICATION_BUDGETS.verifyWallMs,
    perCheckTimeoutMs:
      partial?.perCheckTimeoutMs ??
      DEFAULT_VERIFICATION_BUDGETS.perCheckTimeoutMs,
    maxChecks: partial?.maxChecks ?? DEFAULT_VERIFICATION_BUDGETS.maxChecks,
  };
}
