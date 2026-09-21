/**
 * In-memory desktop shell state.
 * Persistence is SQLite at `<userData>/mitii-desktop.sqlite`.
 */

import {
  mergeDesktopSettings,
  type DesktopSettings,
} from '../shared/settings.js';
import type { DesktopStoreSnapshot } from '../engine/desktop-store.js';

export interface DesktopPersistedState {
  workspaceRoot: string;
  recentWorkspaces: string[];
  settings: DesktopSettings;
}

const MAX_RECENTS = 12;

export function defaultDesktopState(workspaceRoot: string): DesktopPersistedState {
  return {
    workspaceRoot,
    recentWorkspaces: workspaceRoot ? [workspaceRoot] : [],
    settings: mergeDesktopSettings(undefined),
  };
}

export function stateFromStoreSnapshot(
  snapshot: DesktopStoreSnapshot,
  fallbackCwd = '',
): DesktopPersistedState {
  const workspaceRoot = snapshot.activeWorkspace || fallbackCwd;
  const recentWorkspaces = snapshot.workspaces
    .map((w) => w.path)
    .filter(Boolean);
  return {
    workspaceRoot,
    recentWorkspaces: touchRecent(recentWorkspaces, workspaceRoot).slice(
      0,
      MAX_RECENTS,
    ),
    settings: mergeDesktopSettings(snapshot.settings),
  };
}

export function touchRecent(list: string[], workspace: string): string[] {
  const normalized = workspace.trim();
  if (!normalized) return list;
  return [normalized, ...list.filter((x) => x !== normalized)];
}
