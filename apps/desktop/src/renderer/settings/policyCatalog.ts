/** Numeric policy catalog descriptors for token-budget editors. */

import { type TokenBudgetFieldDescriptor } from '@mitii/ui-react';
import { catalogEntriesForPrefix } from '@mitii/settings';

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

export function catalogNumberDescriptors(
  prefix: string,
): TokenBudgetFieldDescriptor[] {
  return catalogEntriesForPrefix(prefix)
    .filter(({ shortKey, entry }) => {
      if (shortKey === 'enabled') return false;
      const t = entry.type;
      return t === 'number' || (Array.isArray(t) && t.includes('number'));
    })
    .map(({ shortKey, entry }) => {
      const max = entry.maximum;
      const kind: TokenBudgetFieldDescriptor['kind'] =
        typeof max === 'number' && max <= 1 ? 'ratio' : 'number';
      return {
        key: shortKey,
        group: prefix === 'loopPolicy' ? 'Loop thresholds' : 'Token budget',
        label: shortKey,
        description: entry.description ?? '',
        kind,
        min: entry.minimum ?? 0,
        ...(typeof max === 'number' ? { max } : {}),
        step: kind === 'ratio' ? 0.01 : 1,
        defaultValue:
          typeof entry.default === 'number' ? entry.default : undefined,
        tier:
          prefix === 'loopPolicy' &&
          /recover|repair|truncat|incomplete|unfulfilled|rejected/i.test(
            shortKey,
          )
            ? 'advanced'
            : 'simple',
      };
    });
}
