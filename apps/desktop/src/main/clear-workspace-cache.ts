/**
 * Clear cached workspace artifacts under project data / `.mitii`.
 * Keeps chats, profiles, skills, and rules so the project can reopen cleanly.
 */

import { existsSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

import { resolveWorkspaceDataTarget } from './storage-locations.js';

/** Directory names under project data that are safe cache / rebuildable. */
const CACHE_DIRS = [
  'logs',
  'memory',
  'lancedb',
  'checkpoints',
  'verification',
  'plans',
  'tasks',
  'diff-preview',
  'artifacts',
  'audit',
] as const;

/** File name prefixes / exact names that are index or runtime cache. */
const CACHE_FILE_MATCHERS: Array<(name: string) => boolean> = [
  (name) => name === 'index-runtime.json',
  (name) => name === 'repository-catalog.json',
  (name) => name === 'last-repository-state.json',
  (name) => name.startsWith('repository-index.sqlite'),
  (name) => name.startsWith('repository-map-'),
  (name) => name.startsWith('repository-graph-'),
  (name) => name === 'desktop-settings.json',
];

export interface ClearWorkspaceCacheResult {
  ok: boolean;
  reason?: string;
  removed: string[];
  dataPath?: string;
}

export function clearWorkspaceCache(
  workspaceRoot: string,
): ClearWorkspaceCacheResult {
  const root = workspaceRoot.trim();
  if (!root) return { ok: false, reason: 'no_workspace', removed: [] };

  try {
    const target = resolveWorkspaceDataTarget(root);
    const dataPath = target.path;
    if (!existsSync(dataPath)) {
      return { ok: true, removed: [], dataPath };
    }

    const removed: string[] = [];

    for (const dir of CACHE_DIRS) {
      const path = join(dataPath, dir);
      if (!existsSync(path)) continue;
      rmSync(path, { recursive: true, force: true });
      removed.push(dir);
    }

    for (const name of readdirSync(dataPath)) {
      if (!CACHE_FILE_MATCHERS.some((match) => match(name))) continue;
      const path = join(dataPath, name);
      rmSync(path, { recursive: true, force: true });
      removed.push(name);
    }

    return { ok: true, removed, dataPath };
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof Error ? error.message : String(error),
      removed: [],
    };
  }
}
