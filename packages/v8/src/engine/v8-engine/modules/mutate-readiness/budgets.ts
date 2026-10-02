/**
 * Per active checklist step: evidence → patch readiness budgets.
 * Table is the source of truth: taskSize × window band.
 * "Turns" means model/tool-loop turns (not individual tool calls).
 */
import type { WindowBudgetBand } from "../../../../modules/window-budget";
import { resolveWindowBudgetBand } from "../../../../modules/window-budget";

export type MutateReadinessTaskSize = "small" | "medium" | "large";

export type MutateReadinessBudget = {
  /** Readonly tool-loop turns on the active step before firing the gate. */
  readonlyTurnsBeforeGate: number;
  /** Cap on RequiredEvidenceBeforePatch paths. */
  maxEvidencePaths: number;
  /**
   * How many times we may demand named reads before escalating to
   * “patch now” even if some paths are still missing (soft, not a hard lock).
   */
  maxEvidenceGateNudgesBeforePatchDemand: number;
};

/**
 * Per-step bind budgets (post-plan execute).
 * Medium defaults locked for P1; Small/Large scaled to stay below Medium/Large discovery.
 *
 * cells = turns / paths / nudges
 */
const BIND_BUDGET_TABLE: Record<
  MutateReadinessTaskSize,
  Record<WindowBudgetBand, MutateReadinessBudget>
> = {
  small: {
    compact: {
      readonlyTurnsBeforeGate: 2,
      maxEvidencePaths: 4,
      maxEvidenceGateNudgesBeforePatchDemand: 2,
    },
    standard: {
      readonlyTurnsBeforeGate: 2,
      maxEvidencePaths: 4,
      maxEvidenceGateNudgesBeforePatchDemand: 2,
    },
    wide: {
      readonlyTurnsBeforeGate: 2,
      maxEvidencePaths: 4,
      maxEvidenceGateNudgesBeforePatchDemand: 2,
    },
  },
  medium: {
    compact: {
      readonlyTurnsBeforeGate: 3,
      maxEvidencePaths: 8,
      maxEvidenceGateNudgesBeforePatchDemand: 2,
    },
    standard: {
      readonlyTurnsBeforeGate: 3,
      maxEvidencePaths: 8,
      maxEvidenceGateNudgesBeforePatchDemand: 2,
    },
    wide: {
      readonlyTurnsBeforeGate: 2,
      maxEvidencePaths: 8,
      maxEvidenceGateNudgesBeforePatchDemand: 2,
    },
  },
  large: {
    compact: {
      readonlyTurnsBeforeGate: 4,
      maxEvidencePaths: 12,
      maxEvidenceGateNudgesBeforePatchDemand: 2,
    },
    standard: {
      readonlyTurnsBeforeGate: 3,
      maxEvidencePaths: 12,
      maxEvidenceGateNudgesBeforePatchDemand: 2,
    },
    wide: {
      readonlyTurnsBeforeGate: 3,
      maxEvidencePaths: 12,
      maxEvidenceGateNudgesBeforePatchDemand: 2,
    },
  },
};

export function resolveMutateReadinessBudget(
  taskSize: MutateReadinessTaskSize | string | undefined,
  windowBandOrTokens?: WindowBudgetBand | number,
): MutateReadinessBudget {
  const size = normalizeTaskSize(taskSize);
  const band = resolveBand(windowBandOrTokens);
  return { ...BIND_BUDGET_TABLE[size][band] };
}

/**
 * Prefer the tighter of size-shaped gate and post-plan soft-nudge threshold.
 */
export function resolveStepReadonlyTurnsBeforeGate(params: {
  taskSize?: MutateReadinessTaskSize | string;
  hasPlan: boolean;
  maxReadOnlyTurnsBeforeMutationNudgeAfterPlan: number;
  windowBandOrTokens?: WindowBudgetBand | number;
}): number {
  const sizeBudget = resolveMutateReadinessBudget(
    params.taskSize,
    params.windowBandOrTokens,
  );
  if (!params.hasPlan) {
    return sizeBudget.readonlyTurnsBeforeGate;
  }
  return Math.min(
    sizeBudget.readonlyTurnsBeforeGate,
    params.maxReadOnlyTurnsBeforeMutationNudgeAfterPlan,
  );
}

function normalizeTaskSize(
  taskSize: MutateReadinessTaskSize | string | undefined,
): MutateReadinessTaskSize {
  if (taskSize === "medium" || taskSize === "large") {
    return taskSize;
  }
  return "small";
}

function resolveBand(
  windowBandOrTokens?: WindowBudgetBand | number,
): WindowBudgetBand {
  if (
    windowBandOrTokens === "compact" ||
    windowBandOrTokens === "standard" ||
    windowBandOrTokens === "wide"
  ) {
    return windowBandOrTokens;
  }
  if (typeof windowBandOrTokens === "number") {
    return resolveWindowBudgetBand(windowBandOrTokens);
  }
  return "standard";
}
