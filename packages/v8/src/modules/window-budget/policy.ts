import { DEFAULT_WINDOW_BUDGET_POLICY } from "./defaults";
import type {
  WindowBudgetPolicy,
  WindowBudgetPolicyOverrides,
} from "./contracts";
import {
  resolveWindowBudgetBand,
  windowBudgetBandDefinition,
  type WindowBudgetBand,
  type WindowBudgetBandDefinition,
} from "./windowBudgetBands";

/**
 * Tunable Window Budget policy. Re-exported so hosts and tests import
 * defaults from one place instead of scattering literals.
 */
export const WINDOW_BUDGET_POLICY = DEFAULT_WINDOW_BUDGET_POLICY;

/**
 * Merge optional overrides onto base defaults (no window band).
 * Prefer `resolveWindowBudgetPolicy` when a context window is known.
 */
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

export interface ResolveWindowBudgetPolicyInput {
  contextWindowTokens: number;
  /**
   * Optional host / Developer Custom overrides (`mitii.tokenBudget.*`).
   * Applied last; only defined keys replace band.
   */
  overrides?: WindowBudgetPolicyOverrides;
}

export interface ResolvedWindowBudgetPolicy {
  band: WindowBudgetBand;
  bandDefinition: WindowBudgetBandDefinition;
  contextWindowTokens: number;
  bandOverrides: WindowBudgetPolicyOverrides;
  /** Final policy: defaults → band → lab. */
  policy: WindowBudgetPolicy;
}

/**
 * Resolve shipped window-budget policy for a context window.
 *
 * Merge order:
 * 1. `DEFAULT_WINDOW_BUDGET_POLICY`
 * 2. Window band overlays from `windowBudgetBands.ts`
 * 3. Optional lab / host overrides
 */
export function resolveWindowBudgetPolicy(
  input: ResolveWindowBudgetPolicyInput,
): ResolvedWindowBudgetPolicy {
  const contextWindowTokens = Math.max(
    0,
    Math.floor(input.contextWindowTokens),
  );
  const band = resolveWindowBudgetBand(contextWindowTokens);
  const bandDefinition = windowBudgetBandDefinition(band);
  const bandOverrides = stripUndefined(bandDefinition.overrides);
  const labOverrides = input.overrides
    ? stripUndefined(input.overrides)
    : undefined;

  const policy: WindowBudgetPolicy = {
    ...DEFAULT_WINDOW_BUDGET_POLICY,
    ...bandOverrides,
    ...labOverrides,
  };

  return {
    band,
    bandDefinition,
    contextWindowTokens,
    bandOverrides,
    policy,
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
