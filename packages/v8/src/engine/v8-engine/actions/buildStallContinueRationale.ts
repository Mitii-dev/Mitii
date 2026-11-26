/**
 * Engine shim — budget-wall rationale lives in runtime gates (§10.3 trim).
 * Legacy BudgetWallReason strings still accepted; hosts see ContinueReason.
 */

import type { TaskList } from "../../../modules/task-list";
import {
  buildBudgetWallRationale as runtimeBuildBudgetWallRationale,
  buildBudgetWallResetMessage as runtimeBuildBudgetWallResetMessage,
  mapLegacyContinueReason,
  shouldOfferBudgetWallContinue as runtimeShouldOfferBudgetWallContinue,
  CONTINUE_REASONS,
  type ContinueReason,
  LEGACY_CONTINUE_REASON_MAP,
} from "../../../runtime";

/** @deprecated Prefer {@link ContinueReason} / {@link mapLegacyContinueReason}. */
export const BUDGET_WALL_REASONS = [
  ...CONTINUE_REASONS,
  ...(Object.keys(LEGACY_CONTINUE_REASON_MAP) as Array<
    keyof typeof LEGACY_CONTINUE_REASON_MAP
  >),
] as const;

/** @deprecated Prefer {@link ContinueReason}. */
export type BudgetWallReason = (typeof BUDGET_WALL_REASONS)[number];

export {
  mapLegacyContinueReason,
  CONTINUE_REASONS,
};
export type { ContinueReason };

export function buildBudgetWallRationale(params: {
  reason: BudgetWallReason | ContinueReason | string;
  changedFiles: readonly string[];
  taskList?: TaskList;
  answer?: string;
  fileReadCalls?: number;
  uniqueFilePathsTouched?: number;
  mutationRequired?: boolean;
  budgetMessage?: string;
}): string {
  return runtimeBuildBudgetWallRationale(params);
}

/** @deprecated Prefer {@link buildBudgetWallRationale} with reason `stalled_or_blocked`. */
export function buildStallContinueRationale(params: {
  changedFiles: readonly string[];
  taskList?: TaskList;
  answer?: string;
  fileReadCalls: number;
  uniqueFilePathsTouched: number;
  mutationRequired?: boolean;
}): string {
  return buildBudgetWallRationale({
    reason: "stalled_or_blocked",
    ...params,
  });
}

export function shouldOfferBudgetWallContinue(params: {
  continueOverrideCount?: number;
  maxContinueOverrides?: number;
}): boolean {
  return runtimeShouldOfferBudgetWallContinue(params);
}

/** @deprecated Prefer {@link shouldOfferBudgetWallContinue}. */
export function shouldOfferStallContinue(params: {
  changedFiles: readonly string[];
  taskList?: TaskList;
  mutationRequired: boolean;
  continueOverrideCount?: number;
  maxContinueOverrides?: number;
}): boolean {
  return shouldOfferBudgetWallContinue(params);
}

export function buildBudgetWallResetMessage(params: {
  reason: BudgetWallReason | ContinueReason | string;
  guidance?: string;
  mutationRequired: boolean;
  changedFiles: readonly string[];
  preflightDiagnostics?: string;
}): string {
  return runtimeBuildBudgetWallResetMessage(params);
}

/** @deprecated Prefer {@link buildBudgetWallResetMessage}. */
export function buildStallContinueResetMessage(params: {
  guidance?: string;
  mutationRequired: boolean;
  changedFiles: readonly string[];
}): string {
  return buildBudgetWallResetMessage({
    reason: "stalled_or_blocked",
    ...params,
  });
}

/** Normalize wall reason before storing on checkpoint / host payloads. */
export function normalizeBudgetWallReason(
  reason: string,
): ContinueReason {
  return mapLegacyContinueReason(reason);
}
