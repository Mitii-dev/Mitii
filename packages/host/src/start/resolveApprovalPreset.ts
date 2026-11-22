/**
 * Map host approval preset id → SDK/V8 approval policy.
 * Single source of truth: getApprovalPresetCopy (builder → guided).
 */

import { getApprovalPresetCopy } from '@mitii/sdk';

export function resolveApprovalPreset(preset: string | undefined): {
  approvalMode: 'never' | 'when_required' | 'every_mutation';
  planApproval: 'policy' | 'never';
} {
  const copy = getApprovalPresetCopy(preset);
  return { ...copy.mapsTo };
}

export function normalizeApprovalPresetId(
  preset: string | undefined,
): string {
  if (
    preset === 'safe' ||
    preset === 'guided' ||
    preset === 'pilot' ||
    preset === 'builder'
  ) {
    return preset === 'builder' ? 'guided' : preset;
  }
  return 'guided';
}
