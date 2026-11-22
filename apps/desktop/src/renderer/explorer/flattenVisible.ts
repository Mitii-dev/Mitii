import type { CreateDraft, FlatRow, TreeEntry } from './explorerTypes.js';

export const EXPLORER_ROW_HEIGHT = 22;
export const EXPLORER_OVERSCAN = 16;

export function flattenVisible(
  entries: TreeEntry[],
  childrenByPath: Record<string, TreeEntry[]>,
  expanded: Set<string>,
  createDraft: CreateDraft | null,
): FlatRow[] {
  const out: FlatRow[] = [];
  const walk = (list: TreeEntry[], depth: number, parentPath: string) => {
    if (createDraft?.parent === parentPath) {
      out.push({ type: 'create', parent: parentPath, depth });
    }
    for (const entry of list) {
      out.push({ type: 'entry', entry, depth });
      if (entry.kind === 'dir' && expanded.has(entry.path)) {
        const kids = childrenByPath[entry.path];
        if (kids) {
          walk(kids, depth + 1, entry.path);
        } else if (createDraft?.parent === entry.path) {
          out.push({ type: 'create', parent: entry.path, depth: depth + 1 });
        }
      }
    }
  };
  walk(entries, 1, '');
  return out;
}
