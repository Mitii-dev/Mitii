/**
 * Electron main ↔ desktop SQLite store via system Node CLI
 * (avoids Electron vs Node better-sqlite3 ABI mismatch).
 */

import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

import type { DesktopSettings } from '../shared/settings.js';
import { mergeDesktopSettings } from '../shared/settings.js';
import type { DesktopProfilesFile } from '../engine/profiles.js';
import {
  desktopStorePath,
  type DesktopStoreSnapshot,
  type DesktopWorkspaceRow,
} from '../engine/desktop-store.js';
import { resolveEngineNodeBinary } from './engine-spawn.js';

export type { DesktopStoreSnapshot, DesktopWorkspaceRow };

export interface DesktopStoreClient {
  dbPath: string;
  migrate(input: {
    userDataPath: string;
    workspaceRoot?: string;
    fallbackSettings?: DesktopSettings;
  }): DesktopStoreSnapshot;
  snapshot(fallbackWorkspace?: string): DesktopStoreSnapshot;
  getWorkspaceSettings(workspaceRoot: string): DesktopSettings | null;
  setWorkspace(
    workspaceRoot: string,
    settings?: DesktopSettings,
  ): DesktopStoreSnapshot;
  saveSettings(
    workspaceRoot: string,
    settings: DesktopSettings,
  ): DesktopStoreSnapshot;
  setIndexMeta(
    workspaceRoot: string,
    meta: { fileCount: number; updatedAt?: string },
  ): void;
  getProfiles(): DesktopProfilesFile;
  setProfiles(profiles: DesktopProfilesFile): DesktopProfilesFile;
}

function runStoreCli(options: {
  distRoot: string;
  dbPath: string;
  op: string;
  payload?: unknown;
}): unknown {
  const node = resolveEngineNodeBinary();
  const script = join(options.distRoot, 'engine', 'desktop-store-cli.js');
  const result = spawnSync(node, [script, options.op], {
    input: JSON.stringify(options.payload ?? {}),
    encoding: 'utf8',
    env: {
      ...process.env,
      MITII_DESKTOP_STORE_PATH: options.dbPath,
      ELECTRON_RUN_AS_NODE: undefined,
    },
    maxBuffer: 8 * 1024 * 1024,
  });

  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    const err = (result.stderr || result.stdout || '').trim();
    throw new Error(err || `desktop_store_cli_exit_${result.status}`);
  }
  const out = (result.stdout || '').trim();
  if (!out) throw new Error('desktop_store_cli_empty');
  return JSON.parse(out) as unknown;
}

export function createDesktopStoreClient(options: {
  userDataPath: string;
  distRoot: string;
}): DesktopStoreClient {
  const dbPath = desktopStorePath(options.userDataPath);

  const call = (op: string, payload?: unknown) =>
    runStoreCli({
      distRoot: options.distRoot,
      dbPath,
      op,
      payload,
    });

  return {
    dbPath,
    migrate(input) {
      const raw = call('migrate', input) as {
        snapshot: DesktopStoreSnapshot;
      };
      return normalizeSnapshot(raw.snapshot);
    },
    snapshot(fallbackWorkspace = '') {
      return normalizeSnapshot(
        call('snapshot', { fallbackWorkspace }) as DesktopStoreSnapshot,
      );
    },
    getWorkspaceSettings(workspaceRoot) {
      const raw = call('get-settings', { workspaceRoot }) as {
        settings: DesktopSettings | null;
      };
      return raw.settings ? mergeDesktopSettings(raw.settings) : null;
    },
    setWorkspace(workspaceRoot, settings) {
      const raw = call('set-workspace', {
        workspaceRoot,
        settings,
      }) as { snapshot: DesktopStoreSnapshot };
      return normalizeSnapshot(raw.snapshot);
    },
    saveSettings(workspaceRoot, settings) {
      const raw = call('save-settings', {
        workspaceRoot,
        settings,
      }) as { snapshot: DesktopStoreSnapshot };
      return normalizeSnapshot(raw.snapshot);
    },
    setIndexMeta(workspaceRoot, meta) {
      call('set-index-meta', {
        workspaceRoot,
        fileCount: meta.fileCount,
        updatedAt: meta.updatedAt,
      });
    },
    getProfiles() {
      return call('get-profiles') as DesktopProfilesFile;
    },
    setProfiles(profiles) {
      const raw = call('set-profiles', { profiles }) as {
        profiles: DesktopProfilesFile;
      };
      return raw.profiles;
    },
  };
}

function normalizeSnapshot(raw: DesktopStoreSnapshot): DesktopStoreSnapshot {
  return {
    activeWorkspace: raw.activeWorkspace || '',
    workspaces: Array.isArray(raw.workspaces) ? raw.workspaces : [],
    profiles: raw.profiles,
    settings: mergeDesktopSettings(raw.settings),
  };
}
