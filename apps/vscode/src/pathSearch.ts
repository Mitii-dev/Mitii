import { readdir, stat } from 'node:fs/promises';
import { join, relative } from 'node:path';

import type { PathSuggestion } from './protocol.js';

const SKIP = new Set([
  '.git',
  'node_modules',
  'dist',
  'coverage',
  '.mitii',
  '.cursor',
]);

/**
 * Bounded workspace path search for @-mention autocomplete.
 */
export async function searchWorkspacePaths(
  workspaceRoot: string,
  query: string,
  limit = 24,
): Promise<PathSuggestion[]> {
  const needle = query.trim().toLowerCase().replace(/^@/, '');
  const hits: PathSuggestion[] = [];

  async function walk(dir: string): Promise<void> {
    if (hits.length >= limit) return;
    let names: string[];
    try {
      names = await readdir(dir);
    } catch {
      return;
    }
    for (const name of names) {
      if (hits.length >= limit) return;
      if (SKIP.has(name)) continue;
      const full = join(dir, name);
      let info;
      try {
        info = await stat(full);
      } catch {
        continue;
      }
      const rel = relative(workspaceRoot, full).replace(/\\/g, '/');
      const match =
        !needle ||
        rel.toLowerCase().includes(needle) ||
        name.toLowerCase().includes(needle);
      if (info.isDirectory()) {
        if (match) hits.push({ path: rel, kind: 'folder' });
        await walk(full);
        continue;
      }
      if (info.isFile() && match) {
        hits.push({ path: rel, kind: 'file' });
      }
    }
  }

  await walk(workspaceRoot);
  return hits.slice(0, limit);
}
