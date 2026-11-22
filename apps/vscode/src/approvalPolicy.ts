import {
  formatApprovalPresetHelp,
  getApprovalPresetCopy,
  type ApprovalPresetCopy,
} from '@mitii/sdk';
import { resolveApprovalPreset } from '@mitii/host';

/**
 * Map VS Code `mitii.safety.approvalMode` preset → engine approval policy.
 * Delegates to host `resolveApprovalPreset` (SDK getApprovalPresetCopy SSOT).
 */
export function resolveApprovalPolicy(preset: string | undefined): {
  approvalMode: 'never' | 'when_required' | 'every_mutation';
  planApproval: 'policy' | 'never';
} {
  return resolveApprovalPreset(preset);
}

export function describeApprovalPreset(
  preset: string | undefined,
): ApprovalPresetCopy {
  return getApprovalPresetCopy(preset);
}

export { formatApprovalPresetHelp };
