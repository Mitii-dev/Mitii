import { describe, expect, it, vi } from 'vitest';

import { acceptWebviewMessage } from '../src/webviewInbound.js';

describe('acceptWebviewMessage', () => {
  it('returns parsed messages without logging', () => {
    const log = vi.fn();
    expect(
      acceptWebviewMessage({ type: 'ask', prompt: 'hi', mode: 'ask' }, log),
    ).toEqual({ type: 'ask', prompt: 'hi', mode: 'ask' });
    expect(log).not.toHaveBeenCalled();
  });

  it('drops and logs unknown message types', () => {
    const log = vi.fn();
    expect(acceptWebviewMessage({ type: 'bogus' }, log)).toBeUndefined();
    expect(log).toHaveBeenCalledWith(
      expect.stringContaining('type=bogus reason=unknown_type'),
    );
  });

  it('drops and logs malformed payloads with issue paths', () => {
    const log = vi.fn();
    expect(
      acceptWebviewMessage({ type: 'ask', prompt: 1, mode: 'ask' }, log),
    ).toBeUndefined();
    expect(log).toHaveBeenCalledWith(
      expect.stringMatching(/reason=invalid_shape.*prompt/),
    );
  });

  it('drops non-object payloads', () => {
    const log = vi.fn();
    expect(acceptWebviewMessage(null, log)).toBeUndefined();
    expect(log).toHaveBeenCalledWith(
      expect.stringContaining('reason=expected_object'),
    );
  });
});
