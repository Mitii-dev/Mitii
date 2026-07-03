import type { ApprovalMode, SafetySettingsPayload } from '../../../vscode/webview/messages';

export type AutonomyPreset = SafetySettingsPayload['autonomyPreset'];

export const AUTONOMY_PRESET_OPTIONS: Array<{
  id: AutonomyPreset;
  label: string;
  title: string;
}> = [
  { id: 'safe', label: 'Safe', title: 'Strictest — all edits and commands need approval, no network' },
  { id: 'guided', label: 'Guided', title: 'Balanced — asks before edits; read-only shell and web fetch allowed' },
  { id: 'builder', label: 'Builder', title: 'Fast — auto-approves writes; mutating shell still reviewed' },
  { id: 'pilot', label: 'Pilot', title: 'High autonomy — auto-approves writes, reviews shell' },
  { id: 'enterprise', label: 'Enterprise', title: 'Locked down — no network, all operations reviewed' },
];

export function deriveSafetyFromAutonomyPreset(preset: AutonomyPreset): SafetySettingsPayload {
  switch (preset) {
    case 'safe':
      return {
        autonomyPreset: preset,
        approvalMode: 'review_all',
        requireApprovalForWrites: true,
        requireApprovalForShell: true,
      };
    case 'guided':
      return {
        autonomyPreset: preset,
        approvalMode: 'ask_edits',
        requireApprovalForWrites: true,
        requireApprovalForShell: false,
      };
    case 'builder':
      return {
        autonomyPreset: preset,
        approvalMode: 'ask_commands',
        requireApprovalForWrites: false,
        requireApprovalForShell: true,
      };
    case 'pilot':
      return {
        autonomyPreset: preset,
        approvalMode: 'auto',
        requireApprovalForWrites: false,
        requireApprovalForShell: true,
      };
    case 'enterprise':
      return {
        autonomyPreset: preset,
        approvalMode: 'review_all',
        requireApprovalForWrites: true,
        requireApprovalForShell: true,
      };
  }
}

export function autonomyPresetFromApprovalMode(
  approvalMode: ApprovalMode,
  currentPreset: AutonomyPreset = 'guided'
): AutonomyPreset {
  if (approvalMode === 'review_all') {
    return currentPreset === 'enterprise' ? 'enterprise' : 'safe';
  }
  if (approvalMode === 'ask_edits') return 'guided';
  if (approvalMode === 'ask_commands') return 'builder';
  if (approvalMode === 'auto') return 'pilot';
  return currentPreset;
}
