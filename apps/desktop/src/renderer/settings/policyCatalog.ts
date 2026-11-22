/** Numeric policy descriptors for token-budget / loop-policy editors. */

import type { TokenBudgetFieldDescriptor } from '@mitii/ui-react';
import {
  DEFAULT_LOOP_POLICY_NUMBERS,
  DEFAULT_V8_LOOP_POLICY_NUMBERS,
  DEFAULT_WINDOW_BUDGET_NUMBERS,
} from '@mitii/ui-core';
import {
  LOOP_POLICY_PRESENTATION,
  SETTINGS_CATALOG,
  TOKEN_BUDGET_PRESENTATION,
  V8_LOOP_POLICY_PRESENTATION,
  projectNumberFields,
  type NumberFieldPresentationMap,
} from '@mitii/settings';

export function numericPolicyRecord(
  block: Record<string, unknown>,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [key, value] of Object.entries(block)) {
    if (key === 'enabled') continue;
    if (typeof value === 'number' && Number.isFinite(value)) {
      out[key] = value;
    }
  }
  return out;
}

export type PolicyPrefix = 'tokenBudget' | 'loopPolicy' | 'v8LoopPolicy';

/**
 * Shared presentation (labels, groups, steps, tiers, Debug visibility) and
 * the renderer-visible ship baseline per prefix. Keys without a baseline fall
 * back to the catalog default.
 */
const POLICY_SOURCES: Record<
  PolicyPrefix,
  {
    overlay: NumberFieldPresentationMap;
    baseline: Readonly<Record<string, number>>;
  }
> = {
  tokenBudget: {
    overlay: TOKEN_BUDGET_PRESENTATION,
    baseline: DEFAULT_WINDOW_BUDGET_NUMBERS,
  },
  loopPolicy: {
    overlay: LOOP_POLICY_PRESENTATION,
    baseline: DEFAULT_LOOP_POLICY_NUMBERS,
  },
  v8LoopPolicy: {
    overlay: V8_LOOP_POLICY_PRESENTATION,
    baseline: DEFAULT_V8_LOOP_POLICY_NUMBERS,
  },
};

/** Renderer-visible ship baseline entries that name a catalog key under `prefix`. */
export function policyBaselineNumbers(prefix: PolicyPrefix): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [key, value] of Object.entries(POLICY_SOURCES[prefix].baseline)) {
    if (SETTINGS_CATALOG[`mitii.${prefix}.${key}`] !== undefined) {
      out[key] = value;
    }
  }
  return out;
}

/** Catalog projection with the shared presentation for a prefix. */
export function catalogNumberDescriptors(
  prefix: PolicyPrefix,
): TokenBudgetFieldDescriptor[] {
  return projectNumberFields(prefix, POLICY_SOURCES[prefix].overlay, {
    tier: () => 'advanced',
    defaults: policyBaselineNumbers(prefix),
  });
}
