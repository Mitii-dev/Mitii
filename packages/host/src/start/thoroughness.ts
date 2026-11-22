/**
 * Map UI thoroughness (Low / Medium / High) → exploration depth + window effort.
 */

import type { HostThoroughness } from './contracts.js';

export const THOROUGHNESS_MAP = {
  low: { depth: 'quick' as const, effort: 'low' as const },
  medium: { depth: 'auto' as const, effort: 'medium' as const },
  high: { depth: 'deep' as const, effort: 'high' as const },
} as const;

export function resolveThoroughness(
  value: string | undefined,
): HostThoroughness {
  return value === 'low' || value === 'high' ? value : 'medium';
}
