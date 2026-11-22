import { describe, expect, it } from 'vitest';

import { detectMentionSuggest, stripTrailingMention } from '../src/index.js';

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

  it('returns null when there is no trailing mention', () => {
    expect(detectMentionSuggest('plain text')).toBeNull();
  });

  it('detects @skill and @mcp with or without a colon', () => {
    expect(detectMentionSuggest('@skill')).toEqual({ mode: 'skill', query: '' });
    expect(detectMentionSuggest('x @skill:mod')).toEqual({
      mode: 'skill',
      query: 'mod',
    });
    expect(detectMentionSuggest('@skill:git')).toEqual({
      mode: 'skill',
      query: 'git',
    });
    expect(detectMentionSuggest('@mcp')).toEqual({ mode: 'mcp', query: '' });
    expect(detectMentionSuggest('@mcp:web')).toEqual({
      mode: 'mcp',
      query: 'web',
    });
  });
});

describe('stripTrailingMention', () => {
  it('removes the trailing path, skill, or mcp token and trailing blanks', () => {
    expect(stripTrailingMention('look at @src/app')).toBe('look at');
    expect(stripTrailingMention('look at @request intake')).toBe('look at');
    expect(stripTrailingMention('use @skill:git')).toBe('use');
    expect(stripTrailingMention('use @mcp:web')).toBe('use');
  });

  it('leaves text without a trailing mention unchanged', () => {
    expect(stripTrailingMention('no mention')).toBe('no mention');
  });
});
