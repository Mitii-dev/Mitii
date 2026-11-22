/**
 * Per active checklist step: evidence → patch readiness budgets.
 * Table is the source of truth: taskSize × window band.
 * "Turns" means model/tool-loop turns (not individual tool calls).
 *
 * Happy-path budgets are separate from the evidence-recovery valve
 * (see evidenceRecovery.ts): numbers define the envelope; the gate
 * defines what happens when reality isn't the happy path.
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
   * recovery / clarify (not unbounded patch-hope).
   */
  maxEvidenceGateNudgesBeforePatchDemand: number;
  /** One capped recovery after happy-path gate budget (turns). */
  evidenceRecoveryTurns: number;
  /** Cap on local paths during recovery (must stay file-local). */
  evidenceRecoveryMaxPaths: number;
};

/**
 * Per-step bind budgets (post-plan execute).
 * Medium locked: Compact 5/10/4 · Standard 4/8/3 · Wide 3/8/3
 * Small: Compact/Standard 4/6/2 · Wide 3/5/2 (room to bind shell App.tsx)
 * Recovery valve shared: 2 turns / 4 paths (never +10 searches).
 *
 * cells = turns / paths / nudges
 */
const BIND_BUDGET_TABLE: Record<
  MutateReadinessTaskSize,
  Record<WindowBudgetBand, MutateReadinessBudget>
> = {
  small: {
    compact: {
      readonlyTurnsBeforeGate: 6,
      maxEvidencePaths: 8,
      maxEvidenceGateNudgesBeforePatchDemand: 2,
      evidenceRecoveryTurns: 2,
      evidenceRecoveryMaxPaths: 4,
    },
    standard: {
      readonlyTurnsBeforeGate: 6,
      maxEvidencePaths: 8,
      maxEvidenceGateNudgesBeforePatchDemand: 2,
      evidenceRecoveryTurns: 2,
      evidenceRecoveryMaxPaths: 4,
    },
    wide: {
      readonlyTurnsBeforeGate: 3,
      maxEvidencePaths: 5,
      maxEvidenceGateNudgesBeforePatchDemand: 2,
      evidenceRecoveryTurns: 1,
      evidenceRecoveryMaxPaths: 3,
    },
  },
  medium: {
    compact: {
      readonlyTurnsBeforeGate: 5,
      maxEvidencePaths: 10,
      maxEvidenceGateNudgesBeforePatchDemand: 4,
      evidenceRecoveryTurns: 2,
      evidenceRecoveryMaxPaths: 4,
    },
    standard: {
      readonlyTurnsBeforeGate: 4,
      maxEvidencePaths: 8,
      maxEvidenceGateNudgesBeforePatchDemand: 3,
      evidenceRecoveryTurns: 2,
      evidenceRecoveryMaxPaths: 4,
    },
    wide: {
      readonlyTurnsBeforeGate: 3,
      maxEvidencePaths: 8,
      maxEvidenceGateNudgesBeforePatchDemand: 3,
      evidenceRecoveryTurns: 2,
      evidenceRecoveryMaxPaths: 4,
    },
  },
  large: {
    compact: {
      readonlyTurnsBeforeGate: 6,
      maxEvidencePaths: 14,
      maxEvidenceGateNudgesBeforePatchDemand: 4,
      evidenceRecoveryTurns: 2,
      evidenceRecoveryMaxPaths: 4,
    },
    standard: {
      readonlyTurnsBeforeGate: 5,
      maxEvidencePaths: 12,
      maxEvidenceGateNudgesBeforePatchDemand: 3,
      evidenceRecoveryTurns: 2,
      evidenceRecoveryMaxPaths: 4,
    },
    wide: {
      readonlyTurnsBeforeGate: 4,
      maxEvidencePaths: 12,
      maxEvidenceGateNudgesBeforePatchDemand: 3,
      evidenceRecoveryTurns: 2,
      evidenceRecoveryMaxPaths: 4,
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
 * When a trusted execution seed is already bound, keep the size×band envelope
 * — do not collapse to free-discovery (2) / after-plan (2) or App.tsx binding
 * starves and mutate lock fires before the handler is read.
 */
export function resolveStepReadonlyTurnsBeforeGate(params: {
  taskSize?: MutateReadinessTaskSize | string;
  hasPlan: boolean;
  maxReadOnlyTurnsBeforeMutationNudgeAfterPlan: number;
  windowBandOrTokens?: WindowBudgetBand | number;
  seedTrusted?: boolean;
}): number {
  const sizeBudget = resolveMutateReadinessBudget(
    params.taskSize,
    params.windowBandOrTokens,
  );
  if (params.seedTrusted) {
    return sizeBudget.readonlyTurnsBeforeGate;
  }
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
