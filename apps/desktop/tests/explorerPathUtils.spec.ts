import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  fileName,
  isMacPlatform,
  isMarkdownPath,
  parentOf,
  remapUnder,
  revealLabel,
  workspaceFolderName,
} from '../src/renderer/explorer/pathUtils.js';

describe('explorer pathUtils', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('detects markdown paths', () => {
    expect(isMarkdownPath('docs/README.md')).toBe(true);
    expect(isMarkdownPath('a.MDX')).toBe(true);
    expect(isMarkdownPath('a.markdown')).toBe(true);
    expect(isMarkdownPath('a.ts')).toBe(false);
  });

  it('extracts file names for posix and windows separators', () => {
    expect(fileName('src/a/b.ts')).toBe('b.ts');
    expect(fileName('src\\a\\b.ts')).toBe('b.ts');
    expect(fileName('plain')).toBe('plain');
  });

  it('computes parent paths', () => {
    expect(parentOf('src/a/b.ts')).toBe('src/a');
    expect(parentOf('top.ts')).toBe('');
  });

  it('shows only the workspace folder name', () => {
    expect(workspaceFolderName('/Users/me/proj')).toBe('proj');
    expect(workspaceFolderName('C:\\work\\proj\\')).toBe('proj');
    expect(workspaceFolderName('')).toBe('Workspace');
  });

  it('remaps exact paths and descendants only', () => {
    expect(remapUnder('a', 'b', 'a')).toBe('b');
    expect(remapUnder('a', 'b', 'a/x.ts')).toBe('b/x.ts');
    expect(remapUnder('a', 'b', 'ab/x.ts')).toBe('ab/x.ts');
    expect(remapUnder('a', 'b', 'other')).toBe('other');
  });

  it('resolves platform labels', () => {
    vi.stubGlobal('navigator', { platform: 'MacIntel' });
    expect(isMacPlatform()).toBe(true);
    expect(revealLabel()).toBe('Reveal in Finder');
    vi.stubGlobal('navigator', { platform: 'Win32' });
    expect(isMacPlatform()).toBe(false);
    expect(revealLabel()).toBe('Reveal in File Explorer');
    vi.stubGlobal('navigator', { platform: 'Linux x86_64' });
    expect(revealLabel()).toBe('Reveal in File Manager');
  });

  it('falls back when navigator is unavailable', () => {
    vi.stubGlobal('navigator', undefined);
    expect(isMacPlatform()).toBe(false);
    expect(revealLabel()).toBe('Reveal in File Manager');
  });
});
