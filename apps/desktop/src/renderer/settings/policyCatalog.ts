/** Numeric policy descriptors for token-budget / loop-policy editors. */

import type { TokenBudgetFieldDescriptor } from '@mitii/ui-react';
import { projectNumberFields } from '@mitii/settings';

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

const LOOP_ADVANCED_KEY = /recover|repair|truncat|incomplete|unfulfilled|rejected/i;

/** Catalog projection with Desktop's group/tier presentation for a prefix. */
export function catalogNumberDescriptors(
  prefix: string,
): TokenBudgetFieldDescriptor[] {
  const loop = prefix === 'loopPolicy';
  return projectNumberFields(
    prefix,
    {},
    {
      group: loop ? 'Loop thresholds' : 'Token budget',
      tier: (shortKey) =>
        loop && LOOP_ADVANCED_KEY.test(shortKey) ? 'advanced' : 'simple',
    },
  );
}
