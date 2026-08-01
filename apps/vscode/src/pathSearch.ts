import type { Dirent } from 'node:fs';
import { readdir } from 'node:fs/promises';
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

const CACHE_TTL_MS = 30_000;
const MAX_CATALOG_ENTRIES = 15_000;
const pathCache = new Map<
  string,
  { expiresAt: number; promise: Promise<PathSuggestion[]> }
>();

/**
 * Bounded workspace path search for @-mention autocomplete.
 */
export async function searchWorkspacePaths(
  workspaceRoot: string,
  query: string,
  limit = 24,
): Promise<PathSuggestion[]> {
  const needle = query.trim().toLowerCase().replace(/^@/, '');
  const catalog = await readCachedCatalog(workspaceRoot);
  return catalog
    .filter((item) => {
      if (!needle) return true;
      const path = item.path.toLowerCase();
      const name = path.split('/').pop() ?? path;
      return path.includes(needle) || name.includes(needle);
    })
    .sort((a, b) => scorePath(b, needle) - scorePath(a, needle))
    .slice(0, limit);
}

async function readCachedCatalog(
  workspaceRoot: string,
): Promise<PathSuggestion[]> {
  const now = Date.now();
  const cached = pathCache.get(workspaceRoot);
  if (cached && cached.expiresAt > now) return cached.promise;
  const promise = buildPathCatalog(workspaceRoot).catch((error) => {
    pathCache.delete(workspaceRoot);
    throw error;
  });
  pathCache.set(workspaceRoot, { expiresAt: now + CACHE_TTL_MS, promise });
  return promise;
}

async function buildPathCatalog(
  workspaceRoot: string,
): Promise<PathSuggestion[]> {
  const entries: PathSuggestion[] = [];

  async function walk(dir: string): Promise<void> {
    if (entries.length >= MAX_CATALOG_ENTRIES) return;
    let names: Dirent[];
    try {
      names = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of names) {
      if (entries.length >= MAX_CATALOG_ENTRIES) return;
      if (SKIP.has(entry.name)) continue;
      const full = join(dir, entry.name);
      const rel = relative(workspaceRoot, full).replace(/\\/g, '/');
      if (entry.isDirectory()) {
        entries.push({ path: rel, kind: 'folder' });
        await walk(full);
      } else if (entry.isFile()) {
        entries.push({ path: rel, kind: 'file' });
      }
    }
  }

  await walk(workspaceRoot);
  return entries.sort((a, b) => {
    const depth = a.path.split('/').length - b.path.split('/').length;
    if (depth !== 0) return depth;
    if (a.kind !== b.kind) return a.kind === 'folder' ? -1 : 1;
    return a.path.localeCompare(b.path);
  });
}

function scorePath(item: PathSuggestion, needle: string): number {
  const path = item.path.toLowerCase();
  const name = path.split('/').pop() ?? path;
  let score = item.kind === 'folder' ? 1 : 0;
  if (!needle) return score - item.path.split('/').length * 0.1;
  if (name === needle) score += 100;
  if (name.startsWith(needle)) score += 60;
  if (path.startsWith(needle)) score += 40;
  if (path.includes(`/${needle}`)) score += 20;
  return score - item.path.split('/').length * 0.2;
}
