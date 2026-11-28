/**
 * Soft rails — nudge only, never suspend (§10 / §6.11.3.1).
 */
export type SoftRailKind =
  | "thrash_nudge"
  | "evidence_nudge"
  | "budget_nudge"
  | "wall_time_nudge";

export interface SoftRailNudge {
  kind: SoftRailKind;
  message: string;
  reasonCodes: string[];
}

export function evaluateSoftRails(params: {
  repeatedToolCalls?: number;
  turnsWithoutEvidence?: number;
  budgetUsedRatio?: number;
  elapsedMs?: number;
  wallTimeSoftMs?: number;
}): SoftRailNudge[] {
  const nudges: SoftRailNudge[] = [];

  if ((params.repeatedToolCalls ?? 0) >= 3) {
    nudges.push({
      kind: "thrash_nudge",
      message: "Same tool pattern repeating — change approach or finalize.",
      reasonCodes: ["rail_thrash"],
    });
  }
  if ((params.turnsWithoutEvidence ?? 0) >= 2) {
    nudges.push({
      kind: "evidence_nudge",
      message: "Gather concrete evidence before more speculation.",
      reasonCodes: ["rail_evidence"],
    });
  }
  if ((params.budgetUsedRatio ?? 0) >= 0.8) {
    nudges.push({
      kind: "budget_nudge",
      message: "Budget nearly spent — prefer finish over more exploration.",
      reasonCodes: ["rail_budget"],
    });
  }
  if (
    params.wallTimeSoftMs != null &&
    (params.elapsedMs ?? 0) >= params.wallTimeSoftMs
  ) {
    nudges.push({
      kind: "wall_time_nudge",
      message: "Soft wall-time reached — wrap up this turn.",
      reasonCodes: ["rail_wall_time"],
    });
  }

  return nudges;
}
