import { describe, expect, it } from 'vitest';

import { detectMentionSuggest } from '../webview-ui/src/mentionSuggest';

describe('detectMentionSuggest', () => {
  it('lists all on bare @', () => {
    expect(detectMentionSuggest('Hello @')).toEqual({
      mode: 'all',
      query: '',
    });
  });

  it('detects @skill without requiring a colon', () => {
    expect(detectMentionSuggest('@skill')).toEqual({
      mode: 'skill',
      query: '',
    });
    expect(detectMentionSuggest('x @skill:mod')).toEqual({
      mode: 'skill',
      query: 'mod',
    });
  });

  it('detects @mcp without requiring a colon', () => {
    expect(detectMentionSuggest('@mcp')).toEqual({
      mode: 'mcp',
      query: '',
    });
    expect(detectMentionSuggest('@mcp:ex')).toEqual({
      mode: 'mcp',
      query: 'ex',
    });
  });

  it('treats other @tokens as paths', () => {
    expect(detectMentionSuggest('@src/app')).toEqual({
      mode: 'path',
      query: 'src/app',
    });
  });
});
