import type { MitiiAutonomyPreset } from '@mitii/sdk';

/**
 * `mitii run --auto` — unattended CI entrypoint.
 *
 * Maps to ask/agent with autonomyPreset `apply` (approval never + agent mode)
 * unless the caller already set a stricter autonomy.
 */
export interface RunAutoResolution {
  autonomyPreset: MitiiAutonomyPreset;
  autoApproval: 'approved';
  origin: 'automation';
}

export function resolveRunAutoOptions(options: {
  auto: boolean;
  autonomyPreset?: MitiiAutonomyPreset;
}): RunAutoResolution | { error: string } {
  if (!options.auto) {
    return {
      error:
        'mitii run: require --auto for unattended CI (or use mitii ask --autonomy apply)',
    };
  }
  return {
    autonomyPreset: options.autonomyPreset ?? 'apply',
    autoApproval: 'approved',
    origin: 'automation',
  };
}
