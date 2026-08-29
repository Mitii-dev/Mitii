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

/**
 * Composer approval must also update the active mode's saved default.
 * Otherwise Save persists a stale modeDefaults value (Agent defaults to
 * `safe`) and Full access appears to reset after reload.
 */
export function approvalModeUiPatch(params: {
  mode: 'ask' | 'plan' | 'agent' | 'review';
  approvalMode: string;
}): {
  approvalMode: ApprovalUiMode;
  modeDefaults: Partial<
    Record<'ask' | 'plan' | 'agent', { approvalMode: ApprovalUiMode }>
  >;
} {
  const settingsMode =
    params.mode === 'plan' || params.mode === 'agent' ? params.mode : 'ask';
  const approvalMode = normalizeApproval(params.approvalMode);
  return {
    approvalMode,
    modeDefaults: {
      [settingsMode]: { approvalMode },
    },
  };
}
