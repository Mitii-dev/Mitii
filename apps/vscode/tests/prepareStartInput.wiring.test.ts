/**
 * Contract: VS Code approval + start helpers stay on host SSOT.
 */
import { describe, expect, it } from 'vitest';
import {
  prepareStartInput,
  resolveApprovalPreset,
} from '@mitii/host';
import { resolveApprovalPolicy } from '../src/approvalPolicy.js';

describe('VS Code start wiring', () => {
  it('approvalPolicy delegates to host resolveApprovalPreset', () => {
    expect(resolveApprovalPolicy('pilot')).toEqual(
      resolveApprovalPreset('pilot'),
    );
    expect(resolveApprovalPolicy('pilot')).toEqual({
      approvalMode: 'never',
      planApproval: 'never',
    });
  });

  it('prepareStartInput is the shared start assembler', async () => {
    const { start, meta } = await prepareStartInput({
      prompt: 'parity check',
      approvalPreset: 'guided',
      userSafety: 'off',
      loadDiskProjectRules: false,
      loadModeProfiles: false,
    });
    expect(start.approvalMode).toBe('when_required');
    expect(start.planApproval).toBe('policy');
    expect(meta.approvalPreset).toBe('guided');
  });
});
