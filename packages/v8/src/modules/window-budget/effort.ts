/**
 * Named working-set overlays. The advertised window still scales retrieval
 * and output reserve; effort caps mutation batches, loop call counts, and
 * compaction ceilings so a 200k model does not keep 30k-sized patches inside
 * a 110k transcript.
 *
 * Hosts SHOULD default to `medium`. Show Low/Medium/High only when the
 * advertised window is above 100k.
 */
export const WINDOW_BUDGET_EFFORTS = ["low", "medium", "high"] as const;

export type WindowBudgetEffort = (typeof WINDOW_BUDGET_EFFORTS)[number];

export const DEFAULT_WINDOW_BUDGET_EFFORT: WindowBudgetEffort = "medium";

export interface WindowBudgetEffortOverlay {
  maxUniqueFilesPerCall: number;
  maxModelCalls: number;
  compactionAutoMaxTokens: number;
  compactionHardMaxTokens: number;
  maxVerificationRepairs: number;
}

export const WINDOW_BUDGET_EFFORT_OVERLAY: Record<
  WindowBudgetEffort,
  WindowBudgetEffortOverlay
> = {
  low: {
    maxUniqueFilesPerCall: 4,
    maxModelCalls: 24,
    compactionAutoMaxTokens: 16_000,
    compactionHardMaxTokens: 24_000,
    maxVerificationRepairs: 0,
  },
  medium: {
    maxUniqueFilesPerCall: 8,
    maxModelCalls: 40,
    compactionAutoMaxTokens: 32_000,
    compactionHardMaxTokens: 40_000,
    maxVerificationRepairs: 8,
  },
  high: {
    maxUniqueFilesPerCall: 12,
    maxModelCalls: 64,
    compactionAutoMaxTokens: 48_000,
    compactionHardMaxTokens: 64_000,
    maxVerificationRepairs: 12,
  },
};

export function resolveWindowBudgetEffort(
  value?: string,
): WindowBudgetEffort {
  if (value === "low" || value === "high" || value === "medium") {
    return value;
  }
  return DEFAULT_WINDOW_BUDGET_EFFORT;
}
