import { WINDOW_BUDGET_BAND_CEILINGS } from "./bands";

/**
 * Named working-set overlays. The advertised context window remains the
 * source of truth for retrieval and output reserve. Effort shapes mutation
 * batches and compaction, and loop call counts scale up on standard and
 * wide windows so a large context is not pinned to the compact ceiling.
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
  /** Soft model-call checkpoint (Continue wall). */
  maxModelCalls: number;
  /** Hard model-call safety ceiling (terminal). */
  hardMaxModelCalls: number;
  /** Soft tool-call checkpoint. */
  maxToolCalls: number;
  /** Hard tool-call safety ceiling. */
  hardMaxToolCalls: number;
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
    hardMaxModelCalls: 72,
    maxToolCalls: 48,
    hardMaxToolCalls: 144,
    compactionAutoWindowRatio: 0.5,
    compactionHardWindowRatio: 0.75,
    compactionAutoMinTokens: 8_000,
    compactionHardMinTokens: 12_000,
    maxVerificationRepairs: 0,
  },
  medium: {
    maxUniqueFilesPerCall: 12,
    // Soft checkpoint — engine offers Continue here, does not die.
    maxModelCalls: 64,
    // Hard safety — ~3× soft so big tasks can Continue twice.
    hardMaxModelCalls: 192,
    maxToolCalls: 128,
    hardMaxToolCalls: 384,
    compactionAutoWindowRatio: 0.8,
    compactionHardWindowRatio: 1,
    compactionAutoMinTokens: 16_000,
    compactionHardMinTokens: 24_000,
    maxVerificationRepairs: 8,
  },
  high: {
    maxUniqueFilesPerCall: 20,
    maxModelCalls: 96,
    hardMaxModelCalls: 288,
    maxToolCalls: 192,
    hardMaxToolCalls: 576,
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
  if (
    value !== undefined &&
    (WINDOW_BUDGET_EFFORTS as readonly string[]).includes(value)
  ) {
    return value as WindowBudgetEffort;
  }
  return DEFAULT_WINDOW_BUDGET_EFFORT;
}

/**
 * Effort bases are tuned for compact windows. Standard and wide windows
 * get more model and tool calls so a 150k context is not stuck on the
 * compact loop ceiling.
 *
 * Compact (under 50k): 1×. Standard (under 100k): 1.5×. Wide: 2×.
 */
export function scaleEffortCallBudget(
  base: number,
  contextWindowTokens: number,
): number {
  const window = Math.floor(contextWindowTokens);
  const calls = Math.max(1, Math.floor(base));
  if (
    !Number.isFinite(window) ||
    window < WINDOW_BUDGET_BAND_CEILINGS.compactMaxExclusive
  ) {
    return calls;
  }
  if (window < WINDOW_BUDGET_BAND_CEILINGS.standardMaxExclusive) {
    return Math.max(calls, Math.round(calls * 1.5));
  }
  return calls * 2;
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
