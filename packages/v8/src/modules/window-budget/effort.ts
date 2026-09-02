/**
 * Named working-set overlays. The advertised context window remains the
 * source of truth for retrieval and output reserve; effort only shapes
 * mutation batches, loop call counts, and compaction aggressiveness.
 *
 * Compaction ceilings are **ratios of the context window** (with small-window
 * floors), so compact / standard / wide budgets and loop history all grow
 * when the host raises `contextWindowTokens`. Absolute 32k/40k caps used to
 * pin large-window runs to a ~30k working set.
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
  /**
   * Auto-compaction ceiling as a fraction of `contextWindowTokens`.
   * Medium ≈ 0.80 so a 40k window keeps the historical 32k auto ceiling.
   */
  compactionAutoWindowRatio: number;
  /**
   * Hard-compaction ceiling as a fraction of `contextWindowTokens`.
   * Medium ≈ 1.0 so a 40k window keeps the historical 40k hard ceiling.
   */
  compactionHardWindowRatio: number;
  /** Floor so tiny windows still compact before overflowing. */
  compactionAutoMinTokens: number;
  compactionHardMinTokens: number;
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
    compactionAutoWindowRatio: 0.5,
    compactionHardWindowRatio: 0.75,
    compactionAutoMinTokens: 8_000,
    compactionHardMinTokens: 12_000,
    maxVerificationRepairs: 0,
  },
  medium: {
    maxUniqueFilesPerCall: 8,
    // Align with the VS Code host default (64). 40 let the first loop
    // consume every call before remaining-error repairs could start.
    maxModelCalls: 64,
    // Keep room for read->patch->verify repair loops on 30k windows.
    maxToolCalls: 128,
    compactionAutoWindowRatio: 0.8,
    compactionHardWindowRatio: 1,
    compactionAutoMinTokens: 16_000,
    compactionHardMinTokens: 24_000,
    maxVerificationRepairs: 8,
  },
  high: {
    maxUniqueFilesPerCall: 12,
    maxModelCalls: 96,
    maxToolCalls: 192,
    compactionAutoWindowRatio: 0.9,
    compactionHardWindowRatio: 1,
    compactionAutoMinTokens: 24_000,
    compactionHardMinTokens: 32_000,
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

/**
 * Scale effort compaction ceilings from the advertised context window.
 * Floors keep small windows from delaying compaction too long.
 */
export function resolveEffortCompactionCeilings(params: {
  contextWindowTokens: number;
  effort?: WindowBudgetEffort | string;
}): { autoMaxTokens: number; hardMaxTokens: number } {
  const effort = resolveWindowBudgetEffort(params.effort);
  const overlay = WINDOW_BUDGET_EFFORT_OVERLAY[effort];
  const windowTokens = Math.max(1, Math.floor(params.contextWindowTokens));
  const autoMaxTokens = Math.max(
    overlay.compactionAutoMinTokens,
    Math.floor(windowTokens * overlay.compactionAutoWindowRatio),
  );
  const hardMaxTokens = Math.max(
    overlay.compactionHardMinTokens,
    Math.floor(windowTokens * overlay.compactionHardWindowRatio),
    autoMaxTokens,
  );
  return { autoMaxTokens, hardMaxTokens };
}
