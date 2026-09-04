import { z } from 'zod';
import type { AgentMode } from '@mitii/v8';

/**
 * Host-facing unattended autonomy presets for automation / API origins.
 *
 * - readonly: investigate only (ask mode, no mutations)
 * - propose: plan / draft only (plan mode)
 * - apply: edit + verify without interactive approvals
 * - apply_and_pr: same approval policy as apply; PR creation is prompt/skill-driven
 */
export const MITII_AUTONOMY_PRESETS = [
  'readonly',
  'propose',
  'apply',
  'apply_and_pr',
] as const;

export const mitiiAutonomyPresetSchema = z.enum(MITII_AUTONOMY_PRESETS);
export type MitiiAutonomyPreset = z.infer<typeof mitiiAutonomyPresetSchema>;

export interface ResolvedAutonomyPreset {
  mode: AgentMode;
  approvalMode: 'never' | 'when_required' | 'every_mutation';
  planApproval: 'policy' | 'never';
}

export function resolveAutonomyPreset(
  preset: MitiiAutonomyPreset,
): ResolvedAutonomyPreset {
  switch (preset) {
    case 'readonly':
      return {
        mode: 'ask',
        approvalMode: 'never',
        planApproval: 'never',
      };
    case 'propose':
      return {
        mode: 'plan',
        approvalMode: 'never',
        planApproval: 'never',
      };
    case 'apply':
    case 'apply_and_pr':
      return {
        mode: 'agent',
        approvalMode: 'never',
        planApproval: 'never',
      };
    default: {
      const _exhaustive: never = preset;
      throw new Error(`Unknown autonomy preset: ${String(_exhaustive)}`);
    }
  }
}
