/**
 * Stable per-repo workspace id for Desktop (indexes, repo intelligence, memory).
 * Same absolute path → same id across sessions.
 */

import { createHash } from 'node:crypto';
import { basename, resolve } from 'node:path';

/** Deterministic id from an absolute (or resolvable) workspace root. */
export function workspaceIdFromRoot(workspaceRoot: string): string {
  const normalized = resolve(workspaceRoot.trim() || '.').replace(/\\/g, '/');
  const digest = createHash('sha256').update(normalized).digest('hex').slice(0, 16);
  return `ws_${digest}`;
}

export function workspaceLabelFromRoot(workspaceRoot: string): string {
  const name = basename(resolve(workspaceRoot.trim() || '.'));
  return name || workspaceRoot;
}
