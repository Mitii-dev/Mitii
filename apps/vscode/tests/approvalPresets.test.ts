import { describe, expect, it } from 'vitest';

import {
  approvalModeUiPatch,
  normalizeApproval,
} from '../webview-ui/src/approvalPresets';

describe('approvalModeUiPatch', () => {
  it('writes Full access into the active agent mode default', () => {
    const patch = approvalModeUiPatch({
      mode: 'agent',
      approvalMode: 'pilot',
    });
    expect(patch.approvalMode).toBe('pilot');
    expect(patch.modeDefaults).toEqual({
      agent: { approvalMode: 'pilot' },
    });
  });

  it('maps review mode onto ask defaults', () => {
    const patch = approvalModeUiPatch({
      mode: 'review',
      approvalMode: 'guided',
    });
    expect(patch.modeDefaults).toEqual({
      ask: { approvalMode: 'guided' },
    });
  });

  it('normalizes legacy builder to guided', () => {
    expect(normalizeApproval('builder')).toBe('guided');
    expect(
      approvalModeUiPatch({ mode: 'plan', approvalMode: 'builder' }).approvalMode,
    ).toBe('guided');
  });
});
