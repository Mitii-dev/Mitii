/**
 * Pre-plan discovery pass budgets: taskSize × window band.
 * Monotonic: compact ≤ standard ≤ wide for every cell (§6.5).
 */
import type { WindowBudgetBand } from "./bands";
import { resolveWindowBudgetBand } from "./bands";

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
  Record<
    WindowBudgetBand,
    Pick<DiscoveryPassBudget, "maxModelTurns" | "maxFileReads">
  >
> = {
  small: {
    compact: { maxModelTurns: 3, maxFileReads: 6 },
    standard: { maxModelTurns: 4, maxFileReads: 8 },
    wide: { maxModelTurns: 5, maxFileReads: 10 },
  },
  medium: {
    compact: { maxModelTurns: 5, maxFileReads: 10 },
    standard: { maxModelTurns: 6, maxFileReads: 12 },
    wide: { maxModelTurns: 8, maxFileReads: 16 },
  },
  large: {
    compact: { maxModelTurns: 7, maxFileReads: 14 },
    standard: { maxModelTurns: 9, maxFileReads: 18 },
    wide: { maxModelTurns: 12, maxFileReads: 24 },
  },
};

/** Legacy fixed fallback when size/band unknown. */
export const DEFAULT_DISCOVERY_PASS_BUDGET: DiscoveryPassBudget = {
  maxModelTurns: 3,
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
  const maxSearches = Math.min(24, Math.max(6, maxFileReads + 2));
  const maxToolCalls = Math.min(
    36,
    Math.max(10, maxFileReads + maxModelTurns + 4),
  );
  return {
    maxModelTurns,
    maxFileReads,
    maxSearches,
    maxToolCalls,
  };
}

/**
 * Shrink a discovery envelope after A/B/C scope lock so the phase stays
 * bounded (default ~65% of the unscoped pass).
 */
export function scaleDiscoveryPassBudget(
  budget: DiscoveryPassBudget,
  factor = 0.65,
): DiscoveryPassBudget {
  const clamped = Math.min(1, Math.max(0.25, factor));
  const scale = (n: number, floor: number) =>
    Math.max(floor, Math.ceil(n * clamped));
  return {
    maxModelTurns: scale(budget.maxModelTurns, 1),
    maxFileReads: scale(budget.maxFileReads, 2),
    maxSearches: scale(budget.maxSearches, 2),
    maxToolCalls: scale(budget.maxToolCalls, 4),
  };
}

/** Assert monotonicity for tests / telemetry. */
export function assertDiscoveryBudgetsMonotonic(): void {
  const sizes: DiscoveryTaskSize[] = ["small", "medium", "large"];
  const bands: WindowBudgetBand[] = ["compact", "standard", "wide"];
  for (const size of sizes) {
    let prevTurns = 0;
    let prevReads = 0;
    for (const band of bands) {
      const b = resolveDiscoveryPassBudget(size, band);
      if (b.maxModelTurns < prevTurns || b.maxFileReads < prevReads) {
        throw new Error(
          `discovery budget non-monotonic: ${size}/${band}`,
        );
      }
      prevTurns = b.maxModelTurns;
      prevReads = b.maxFileReads;
    }
  }
}
