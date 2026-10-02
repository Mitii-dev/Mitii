/**
 * Pre-plan discovery pass budgets: taskSize × window band.
 * "Turns" = model/tool-loop turns (not individual tool calls).
 * Free pre-seed discovery stays fixed at 2 elsewhere; this is the
 * bounded discover_and_plan envelope after seed binding starts.
 */
import type { WindowBudgetBand } from "../../../../modules/window-budget";
import { resolveWindowBudgetBand } from "../../../../modules/window-budget";

export type DiscoveryTaskSize = "small" | "medium" | "large";

export type DiscoveryPassBudget = {
  /** Model/tool-loop turns during discovery. */
  maxModelTurns: number;
  /** Cap on file reads (seed pre-reads + model reads). */
  maxFileReads: number;
  /** Cap on search/glob tool uses. */
  maxSearches: number;
  /** Cap on total discovery tool calls. */
  maxToolCalls: number;
};

/** cells = turns / paths(=reads) — searches/toolCalls derived. */
const DISCOVERY_BUDGET_TABLE: Record<
  DiscoveryTaskSize,
  Record<WindowBudgetBand, Pick<DiscoveryPassBudget, "maxModelTurns" | "maxFileReads">>
> = {
  small: {
    compact: { maxModelTurns: 3, maxFileReads: 6 },
    standard: { maxModelTurns: 2, maxFileReads: 4 },
    wide: { maxModelTurns: 2, maxFileReads: 4 },
  },
  medium: {
    compact: { maxModelTurns: 5, maxFileReads: 10 },
    standard: { maxModelTurns: 4, maxFileReads: 8 },
    wide: { maxModelTurns: 3, maxFileReads: 8 },
  },
  large: {
    compact: { maxModelTurns: 7, maxFileReads: 14 },
    standard: { maxModelTurns: 6, maxFileReads: 12 },
    wide: { maxModelTurns: 5, maxFileReads: 12 },
  },
};

/** Legacy fixed fallback when size/band unknown. */
export const DEFAULT_DISCOVERY_PASS_BUDGET: DiscoveryPassBudget = {
  maxModelTurns: 2,
  maxFileReads: 8,
  maxSearches: 10,
  maxToolCalls: 14,
};

export function resolveDiscoveryPassBudget(
  taskSize?: DiscoveryTaskSize | string,
  windowBandOrTokens?: WindowBudgetBand | number,
): DiscoveryPassBudget {
  const size =
    taskSize === "medium" || taskSize === "large" ? taskSize : "small";
  const band =
    windowBandOrTokens === "compact" ||
    windowBandOrTokens === "standard" ||
    windowBandOrTokens === "wide"
      ? windowBandOrTokens
      : typeof windowBandOrTokens === "number"
        ? resolveWindowBudgetBand(windowBandOrTokens)
        : "standard";
  const cell = DISCOVERY_BUDGET_TABLE[size][band];
  const maxFileReads = cell.maxFileReads;
  const maxModelTurns = cell.maxModelTurns;
  // Keep search/tool headroom proportional to reads without unbounded explore.
  const maxSearches = Math.min(12, Math.max(6, maxFileReads + 2));
  const maxToolCalls = Math.min(20, Math.max(10, maxFileReads + maxModelTurns + 4));
  return {
    maxModelTurns,
    maxFileReads,
    maxSearches,
    maxToolCalls,
  };
}
