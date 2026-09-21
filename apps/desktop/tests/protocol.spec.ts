import { describe, expect, it } from 'vitest';

import {
  MITII_DESKTOP_PROTOCOL,
  MITII_DESKTOP_PROTOCOL_VERSION,
  createPromptId,
  isDesktopAgentMode,
  parseDesktopPromptBody,
} from '../src/shared/protocol.js';

describe('mitii-desktop protocol', () => {
  it('exports stable protocol identity', () => {
    expect(MITII_DESKTOP_PROTOCOL).toBe('mitii-desktop/v1');
    expect(MITII_DESKTOP_PROTOCOL_VERSION).toBe(1);
  });

  it('accepts ask|plan|agent only', () => {
    expect(isDesktopAgentMode('ask')).toBe(true);
    expect(isDesktopAgentMode('plan')).toBe(true);
    expect(isDesktopAgentMode('agent')).toBe(true);
    expect(isDesktopAgentMode('review')).toBe(false);
    expect(isDesktopAgentMode(null)).toBe(false);
  });

  it('parses prompt bodies and rejects empties', () => {
    expect(parseDesktopPromptBody({ prompt: '  hello  ', mode: 'ask' })).toEqual(
      {
        prompt: 'hello',
        mode: 'ask',
      },
    );
    expect(parseDesktopPromptBody({ prompt: '' })).toEqual({
      error: 'prompt_required',
    });
    expect(parseDesktopPromptBody(null)).toEqual({ error: 'expected_object' });
    expect(parseDesktopPromptBody({ prompt: 'x', id: 'p1' })).toEqual({
      prompt: 'x',
      id: 'p1',
    });
  });

  it('creates stable-ish prompt ids', () => {
    expect(createPromptId('fixed')).toBe('fixed');
    expect(createPromptId()).toMatch(/^prompt_/);
  });
});
