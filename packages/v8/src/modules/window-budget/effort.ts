/**
 * Named working-set overlays. The advertised window still scales retrieval
 * and output reserve; effort caps mutation batches, loop call counts, and
 * compaction ceilings so a 200k model does not keep 30k-sized patches inside
 * a 110k transcript.
 *
 * Hosts SHOULD default to `medium` and expose Low / Medium / High in the
 * composer. The overlay still applies on small windows because it caps
 * model/tool/repair counts, not only retrieval size.
 */
export const WINDOW_BUDGET_EFFORTS = ["low", "medium", "high"] as const;

export type WindowBudgetEffort = (typeof WINDOW_BUDGET_EFFORTS)[number];

export const DEFAULT_WINDOW_BUDGET_EFFORT: WindowBudgetEffort = "medium";

export interface WindowBudgetEffortOverlay {
  maxUniqueFilesPerCall: number;
  maxModelCalls: number;
  maxToolCalls: number;
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
    maxToolCalls: 48,
    compactionAutoMaxTokens: 16_000,
    compactionHardMaxTokens: 24_000,
    maxVerificationRepairs: 0,
  },
  medium: {
    maxUniqueFilesPerCall: 8,
    // Align with the VS Code host default (64). 40 let the first loop
    // consume every call before remaining-error repairs could start.
    maxModelCalls: 64,
    // Keep room for read->patch->verify repair loops on 30k windows.
    maxToolCalls: 128,
    compactionAutoMaxTokens: 32_000,
    compactionHardMaxTokens: 40_000,
    maxVerificationRepairs: 8,
  },
  high: {
    maxUniqueFilesPerCall: 12,
    maxModelCalls: 96,
    maxToolCalls: 192,
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
