import { describe, expect, it } from 'vitest';

import type { TreeEntry } from '../src/renderer/explorer/explorerTypes.js';
import {
  EXPLORER_OVERSCAN,
  EXPLORER_ROW_HEIGHT,
  flattenVisible,
} from '../src/renderer/explorer/flattenVisible.js';

const dir = (path: string): TreeEntry => ({
  name: path.split('/').pop()!,
  path,
  kind: 'dir',
});
const file = (path: string): TreeEntry => ({
  name: path.split('/').pop()!,
  path,
  kind: 'file',
});

describe('flattenVisible', () => {
  const root = [dir('src'), file('README.md')];
  const children = { src: [file('src/a.ts'), dir('src/lib')] };

  it('exposes stable virtual-list constants', () => {
    expect(EXPLORER_ROW_HEIGHT).toBe(22);
    expect(EXPLORER_OVERSCAN).toBe(16);
  });

  it('lists root entries at depth 1 when nothing is expanded', () => {
    const rows = flattenVisible(root, children, new Set(), null);
    expect(rows).toEqual([
      { type: 'entry', entry: root[0], depth: 1 },
      { type: 'entry', entry: root[1], depth: 1 },
    ]);
  });

  it('descends into expanded dirs with loaded children', () => {
    const rows = flattenVisible(root, children, new Set(['src']), null);
    expect(rows.map((r) => (r.type === 'entry' ? [r.entry.path, r.depth] : r))).toEqual([
      ['src', 1],
      ['src/a.ts', 2],
      ['src/lib', 2],
      ['README.md', 1],
    ]);
  });

  it('skips expanded dirs whose children are not loaded', () => {
    const rows = flattenVisible(root, {}, new Set(['src']), null);
    expect(rows).toHaveLength(2);
  });

  it('injects a create row at the workspace root first', () => {
    const rows = flattenVisible(root, children, new Set(), {
      parent: '',
      kind: 'file',
      name: 'x',
    });
    expect(rows[0]).toEqual({ type: 'create', parent: '', depth: 1 });
    expect(rows).toHaveLength(3);
  });

  it('injects a create row inside an expanded loaded folder', () => {
    const rows = flattenVisible(root, children, new Set(['src']), {
      parent: 'src',
      kind: 'dir',
      name: 'x',
    });
    expect(rows[1]).toEqual({ type: 'create', parent: 'src', depth: 2 });
  });

  it('shows the create row for an expanded folder still loading', () => {
    const rows = flattenVisible(root, {}, new Set(['src']), {
      parent: 'src',
      kind: 'file',
      name: 'x',
    });
    expect(rows[1]).toEqual({ type: 'create', parent: 'src', depth: 2 });
  });
});
