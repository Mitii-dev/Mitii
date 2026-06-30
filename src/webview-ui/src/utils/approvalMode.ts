import type { ApprovalMode, SafetySettingsPayload } from '../../../vscode/webview/messages';

export const APPROVAL_MODE_OPTIONS: Array<{ id: ApprovalMode; label: string; title: string }> = [
  {
    id: 'review_all',
    label: 'Ask all',
    title: 'Pause before file edits and shell commands',
  },
  {
    id: 'ask_edits',
    label: 'Ask edits',
    title: 'Pause before file edits only',
  },
  {
    id: 'ask_deletes',
    label: 'Ask deletes',
    title: 'Pause before delete-like commands only',
  },
  {
    id: 'ask_commands',
    label: 'Ask cmds',
    title: 'Pause before shell commands only',
  },
  {
    id: 'auto',
    label: 'Auto',
    title: 'Auto-approve allowed operations',
  },
];

export function deriveSafetySettings(approvalMode: ApprovalMode): SafetySettingsPayload {
  switch (approvalMode) {
    case 'review_all':
      return { approvalMode, requireApprovalForWrites: true, requireApprovalForShell: true, autonomyPreset: 'safe' };
    case 'ask_edits':
      return { approvalMode, requireApprovalForWrites: true, requireApprovalForShell: false, autonomyPreset: 'guided' };
    case 'ask_deletes':
      return { approvalMode, requireApprovalForWrites: false, requireApprovalForShell: false, autonomyPreset: 'builder' };
    case 'ask_commands':
      return { approvalMode, requireApprovalForWrites: false, requireApprovalForShell: true, autonomyPreset: 'builder' };
    case 'auto':
      return { approvalMode, requireApprovalForWrites: false, requireApprovalForShell: false, autonomyPreset: 'pilot' };
  }
}

export function approvalModeDescription(mode: ApprovalMode): string {
  return APPROVAL_MODE_OPTIONS.find((option) => option.id === mode)?.title ?? mode;
}
