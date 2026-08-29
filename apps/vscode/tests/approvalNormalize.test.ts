import { describe, expect, it } from 'vitest';

import { normalizeApproval } from '../webview-ui/src/approvalPresets.ts';

describe('normalizeApproval', () => {
  it('keeps the three primary presets', () => {
    expect(normalizeApproval('safe')).toBe('safe');
    expect(normalizeApproval('guided')).toBe('guided');
    expect(normalizeApproval('pilot')).toBe('pilot');
  });

  it('maps legacy builder to guided', () => {
    expect(normalizeApproval('builder')).toBe('guided');
  });

  it('defaults unknown values to guided', () => {
    expect(normalizeApproval('')).toBe('guided');
    expect(normalizeApproval('nope')).toBe('guided');
  });
});
