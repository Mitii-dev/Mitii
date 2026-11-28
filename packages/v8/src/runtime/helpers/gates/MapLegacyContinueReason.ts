import {
  CONTINUE_REASONS,
  type ContinueReason,
} from "./constants";

/**
 * Legacy engine BudgetWallReason strings (one-release shim → §10.3 ContinueReason).
 */
export const LEGACY_CONTINUE_REASON_MAP = {
  exploration_stall: "stalled_or_blocked",
  rejected_mutation: "stalled_or_blocked",
  unfulfilled_execute: "incomplete_progress",
  incomplete_execute: "incomplete_progress",
  incomplete_checklist: "incomplete_progress",
  budget_exhausted: "budget_exhausted",
  verification_repair_capped: "verification_repair_capped",
  evidence_clarify: "evidence_clarify",
  provider_unavailable: "provider_unavailable",
} as const satisfies Record<string, ContinueReason>;

export type LegacyContinueReason = keyof typeof LEGACY_CONTINUE_REASON_MAP;

/** Accept trimmed or legacy reason; always emit §10.3 ContinueReason. */
export function mapLegacyContinueReason(reason: string): ContinueReason {
  if ((CONTINUE_REASONS as readonly string[]).includes(reason)) {
    return reason as ContinueReason;
  }
  const mapped =
    LEGACY_CONTINUE_REASON_MAP[reason as LegacyContinueReason];
  return mapped ?? "stalled_or_blocked";
}

export function isLegacyContinueReason(reason: string): boolean {
  return reason in LEGACY_CONTINUE_REASON_MAP;
}
