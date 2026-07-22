import { describe, expect, it } from 'vitest';
import {
  isPassingVerificationEvidence,
  resolveVerificationEvidence,
} from '../src/features/ce/runtime/verificationEvidence';
import { countsAsVerificationSuccess } from '../src/features/ce/runtime/toolResultHelpers';

describe('verificationEvidence', () => {
  it('treats successful build commands as passing verification', () => {
    const evidence = resolveVerificationEvidence(
      'run_command',
      { success: true, output: 'ok' },
      { command: 'npm run build' }
    );
    expect(evidence?.status).toBe('passed');
    expect(isPassingVerificationEvidence(evidence)).toBe(true);
  });

  it('does not treat inspection commands as passing verification', () => {
    const evidence = resolveVerificationEvidence(
      'run_command',
      { success: true, output: '/workspace' },
      { command: 'pwd' }
    );
    expect(evidence?.status).toBe('inconclusive');
    expect(countsAsVerificationSuccess('run_command', { success: true, output: '/workspace' }, undefined, { command: 'pwd' })).toBe(false);
  });

  it('treats failed verification commands as failed evidence', () => {
    const evidence = resolveVerificationEvidence(
      'run_command',
      { success: false, output: 'error TS2304' },
      { command: 'npm run typecheck' }
    );
    expect(evidence?.status).toBe('failed');
    expect(countsAsVerificationSuccess('run_command', { success: false, output: 'error' }, undefined, { command: 'npm run typecheck' })).toBe(false);
  });

  it('counts diagnostics success as verification when successful', () => {
    expect(countsAsVerificationSuccess('diagnostics', { success: true, output: '[]' })).toBe(true);
  });

  it('ignores skipped tool results', () => {
    expect(
      countsAsVerificationSuccess(
        'run_command',
        { success: true, skipped: true, output: 'Skipped' },
        undefined,
        { command: 'npm run build' }
      )
    ).toBe(false);
  });
});

describe('ToolPolicyEngine metadata parity', () => {
  it('keeps policy read-only set aligned with ask allowlist core reads', async () => {
    const { ASK_ALLOWED_TOOL_IDS, POLICY_READ_ONLY_TOOL_IDS, SHELL_TOOL_IDS } =
      await import('../src/features/ce/tools/toolMetadata');
    for (const tool of ASK_ALLOWED_TOOL_IDS) {
      if (SHELL_TOOL_IDS.has(tool)) continue;
      expect(POLICY_READ_ONLY_TOOL_IDS.has(tool)).toBe(true);
    }
  });
});
