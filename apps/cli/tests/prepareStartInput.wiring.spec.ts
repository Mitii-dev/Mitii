/**
 * Contract: CLI ask + connector stay on host prepareStartInput SSOT.
 */
import { describe, expect, it } from 'vitest';
import {
  HostStartOptionsError,
  prepareStartInput,
  resolveApprovalPreset,
} from '@mitii/host';

describe('CLI start wiring', () => {
  it('prepareStartInput maps pilot / approve override like headless CLI', async () => {
    const { start } = await prepareStartInput({
      prompt: 'ship it',
      approvalPreset: 'guided',
      approvalOverride: {
        approvalMode: 'never',
        planApproval: 'never',
      },
      userSafety: 'off',
      loadDiskProjectRules: false,
      loadModeProfiles: false,
      origin: 'automation',
      steering: {
        decisionBrief: true,
        criticMode: 'enforce',
        policyFactsFirst: true,
      },
    });
    expect(start.approvalMode).toBe('never');
    expect(start.planApproval).toBe('never');
    expect(start.steering?.criticMode).toBe('enforce');
    expect(start.origin).toBe('automation');
  });

  it('unknown profileOverride raises HostStartOptionsError', async () => {
    await expect(
      prepareStartInput({
        prompt: 'hi',
        workspaceRoot: process.cwd(),
        profileOverride: 'definitely-missing-profile-xyz',
        userSafety: 'off',
        loadDiskProjectRules: false,
      }),
    ).rejects.toBeInstanceOf(HostStartOptionsError);
  });

  it('resolveApprovalPreset remains the approval SSOT', () => {
    expect(resolveApprovalPreset('pilot')).toEqual({
      approvalMode: 'never',
      planApproval: 'never',
    });
  });
});
