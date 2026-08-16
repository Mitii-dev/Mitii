import { DEFAULT_WINDOW_BUDGET_POLICY } from "./defaults";
import type {
  WindowBudgetPolicy,
  WindowBudgetPolicyOverrides,
} from "./contracts";

/**
 * Tunable Window Budget policy. Re-exported so hosts and tests import
 * defaults from one place instead of scattering literals.
 */
export const WINDOW_BUDGET_POLICY = DEFAULT_WINDOW_BUDGET_POLICY;

export function mergeWindowBudgetPolicy(
  overrides?: WindowBudgetPolicyOverrides,
): WindowBudgetPolicy {
  if (!overrides) {
    return { ...DEFAULT_WINDOW_BUDGET_POLICY };
  }
  return {
    ...DEFAULT_WINDOW_BUDGET_POLICY,
    ...stripUndefined(overrides),
  };
}

function stripUndefined<T extends object>(value: T): Partial<T> {
  const next: Partial<T> = {};
  for (const [key, entry] of Object.entries(value) as Array<
    [keyof T, T[keyof T] | undefined]
  >) {
    if (entry !== undefined) {
      next[key] = entry;
    }
  }
  return next;
}
