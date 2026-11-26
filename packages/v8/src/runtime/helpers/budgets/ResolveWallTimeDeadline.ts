/**
 * Host wall-time budget handling. Hosts (benchmarks, CI, automation) pass
 * `budget.maxWallTimeMs`; the engine reserves a tail slice so a landed patch
 * can be verified and reported instead of being cut off mid-turn.
 */
export const WALL_TIME_WRAP_UP = {
  /** Fraction of the budget held back for verification + final report. */
  reserveFraction: 0.15,
  minReserveMs: 15_000,
  maxReserveMs: 90_000,
  /** The reserve never exceeds this share of the whole budget. */
  maxShareOfBudget: 0.5,
} as const;

export type WallTimeDeadlineAction =
  | "continue"
  | "finalize_after_mutation"
  | "wrap_up_nudge";

export function resolveWallTimeReserveMs(maxWallTimeMs: number): number {
  if (!Number.isFinite(maxWallTimeMs) || maxWallTimeMs <= 0) {
    return 0;
  }
  const byFraction = Math.round(maxWallTimeMs * WALL_TIME_WRAP_UP.reserveFraction);
  const clamped = Math.min(
    WALL_TIME_WRAP_UP.maxReserveMs,
    Math.max(WALL_TIME_WRAP_UP.minReserveMs, byFraction),
  );
  return Math.min(
    clamped,
    Math.floor(maxWallTimeMs * WALL_TIME_WRAP_UP.maxShareOfBudget),
  );
}

export function isWithinWallTimeReserve(params: {
  remainingMs: number;
  maxWallTimeMs: number;
}): boolean {
  return params.remainingMs <= resolveWallTimeReserveMs(params.maxWallTimeMs);
}

/**
 * Near the deadline: prefer finalizing after a landed mutation (verification
 * decides) over another model turn; with no mutation yet and one required,
 * nudge once to patch now.
 */
export function decideWallTimeDeadline(params: {
  remainingMs: number;
  maxWallTimeMs: number;
  mutationApplied: boolean;
  mutationRequired: boolean;
  alreadyNudged: boolean;
}): WallTimeDeadlineAction {
  if (!isWithinWallTimeReserve(params)) {
    return "continue";
  }
  if (params.mutationApplied) {
    return "finalize_after_mutation";
  }
  if (params.mutationRequired && !params.alreadyNudged) {
    return "wrap_up_nudge";
  }
  return "continue";
}

export function buildWallTimeWrapUpNudge(remainingMs: number): string {
  const seconds = Math.max(0, Math.round(remainingMs / 1000));
  return `Time budget nearly exhausted (~${seconds}s left). Stop exploring: apply the required edit now with the tools already granted, then give a one-line summary. Do not start new discovery.`;
}
