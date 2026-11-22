import { describe, expect, it } from 'vitest';

import {
  buildWorkspaceSketch,
  WORKSPACE_SKETCH_DEFAULTS,
} from './workspaceSketch.js';

describe('buildWorkspaceSketch', () => {
  it('formats a breadth-first tree from relative paths', () => {
    const sketch = buildWorkspaceSketch(
      [
        'src/app/Main.ts',
        'src/app/Other.ts',
        'src/utils.ts',
        'README.md',
        'package.json',
      ],
      { maximumItems: 50 },
    );

    expect(sketch.content).toContain('README.md');
    expect(sketch.content).toContain('package.json');
    expect(sketch.content).toContain('src/');
    expect(sketch.content).toContain('Main.ts');
    expect(sketch.truncated).toBe(false);
    expect(sketch.includedItems).toBeGreaterThan(5);
  });

  it('truncates by BFS item budget instead of dumping deep leaves', () => {
    const paths = [
      'a/deep/leaf.ts',
      'b/one.ts',
      'c/two.ts',
      'd/three.ts',
      'e/four.ts',
    ];
    const sketch = buildWorkspaceSketch(paths, { maximumItems: 6 });

    expect(sketch.truncated).toBe(true);
    expect(sketch.content).toContain(WORKSPACE_SKETCH_DEFAULTS.TRUNCATION_INDICATOR);
    // Prefer sibling directories over finishing a deep branch.
    expect(sketch.content).toContain('b/');
    expect(sketch.content).toContain('c/');
  });
});
