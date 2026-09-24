import { describe, expect, it } from 'vitest';

import {
  flattenWorkingTreeFiles,
  parseAheadBehind,
  parsePorcelainWorkingTree,
} from '../src/shared/git/workingTree.js';
import {
  appendPathsAfterDoubleDash,
  assertSafeGitArg,
  DesktopGitArgError,
} from '../src/engine/git/argSafety.js';

describe('parsePorcelainWorkingTree', () => {
  it('splits staged, changes, and untracked', () => {
    const raw = [
      '## main...origin/main [ahead 1, behind 2]',
      'M  staged.ts',
      ' M dirty.ts',
      'MM both.ts',
      '?? new.ts',
      'R  old.ts -> renamed.ts',
    ].join('\n');

    const parsed = parsePorcelainWorkingTree(raw);
    expect(parsed.branch).toBe('main');
    expect(parsed.ahead).toBe(1);
    expect(parsed.behind).toBe(2);
    expect(parsed.staged.map((f) => f.path)).toEqual([
      'staged.ts',
      'both.ts',
      'renamed.ts',
    ]);
    expect(parsed.changes.map((f) => f.path)).toEqual(['dirty.ts', 'both.ts']);
    expect(parsed.untracked.map((f) => f.path)).toEqual(['new.ts']);
    expect(flattenWorkingTreeFiles(parsed).map((f) => f.path)).toEqual([
      'staged.ts',
      'both.ts',
      'renamed.ts',
      'dirty.ts',
      'new.ts',
    ]);
  });

  it('parseAheadBehind handles missing trailer', () => {
    expect(parseAheadBehind('## feature')).toEqual({});
  });
});

describe('gitArgSafety', () => {
  it('rejects flag-like args', () => {
    expect(() => assertSafeGitArg('-rf', 'git path')).toThrow(DesktopGitArgError);
    expect(appendPathsAfterDoubleDash(['add'], ['src/a.ts'])).toEqual([
      'add',
      '--',
      'src/a.ts',
    ]);
  });
});
