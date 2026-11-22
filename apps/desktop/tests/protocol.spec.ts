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
    expect(isDesktopAgentMode('database')).toBe(true);
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

describe('mitii-desktop stream + resume contracts', () => {
  it('parses NDJSON envelope lines with typed events', async () => {
    const { parseDesktopStreamLine, parseDesktopResumeBody } = await import(
      '../src/shared/protocol.js'
    );
    const ok = parseDesktopStreamLine(
      '{"op":"event","id":"1","event":{"type":"tool_completed"}}',
    );
    expect(ok.ok).toBe(true);
    expect(
      parseDesktopStreamLine('{"op":"event","id":"1","event":{}}').ok,
    ).toBe(false);
    expect(parseDesktopResumeBody({ runId: '' })).toEqual({
      ok: false,
      error: 'runId_required',
    });
  });
});
