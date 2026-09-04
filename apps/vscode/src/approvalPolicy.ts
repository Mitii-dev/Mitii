import {
  getApprovalPresetCopy,
  formatApprovalPresetHelp,
  type ApprovalPresetCopy,
} from '@mitii/v8';

/**
 * Map VS Code `mitii.safety.approvalMode` preset → engine approval policy.
 * Extracted from hostAsk to keep approval UX copy in one place (<800 LOC hosts).
 */
export function resolveApprovalPolicy(preset: string | undefined): {
  approvalMode: 'never' | 'when_required' | 'every_mutation';
  planApproval: 'policy' | 'never';
} {
  const copy = getApprovalPresetCopy(preset);
  return { ...copy.mapsTo };
}

export function describeApprovalPreset(preset: string | undefined): ApprovalPresetCopy {
  return getApprovalPresetCopy(preset);
}

export { formatApprovalPresetHelp };
