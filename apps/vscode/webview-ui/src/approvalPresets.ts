/**
 * Host approval presets (`mitii.safety.approvalMode`).
 * Composer surfaces three choices; legacy `builder` maps to guided.
 */
export type ApprovalUiMode = 'safe' | 'guided' | 'pilot';

export const APPROVAL_UI_MODES = ['safe', 'guided', 'pilot'] as const;

export function normalizeApproval(value: string): ApprovalUiMode {
  if (value === 'safe' || value === 'guided' || value === 'pilot') {
    return value;
  }
  if (value === 'builder') return 'guided';
  return 'guided';
}
