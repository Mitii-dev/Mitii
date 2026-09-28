import { describe, expect, it } from 'vitest';

import { detectMentionSuggest } from '../src/renderer/chat/mentionSuggest.js';

describe('detectMentionSuggest', () => {
  it('uses all mode for bare @ and path mode once typing', () => {
    expect(detectMentionSuggest('hello @')).toEqual({
      mode: 'all',
      query: '',
    });
    expect(detectMentionSuggest('hello @internal')).toEqual({
      mode: 'path',
      query: 'internal',
    });
    expect(detectMentionSuggest('pin @src/features')).toEqual({
      mode: 'path',
      query: 'src/features',
    });
    expect(detectMentionSuggest('pin @request intake')).toEqual({
      mode: 'path',
      query: 'request intake',
    });
  });

  it('keeps skill and mcp modes', () => {
    expect(detectMentionSuggest('@skill:git')).toEqual({
      mode: 'skill',
      query: 'git',
    });
    expect(detectMentionSuggest('@mcp:web')).toEqual({
      mode: 'mcp',
      query: 'web',
    });
  });
});
