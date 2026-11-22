import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { errorMessage } from '../shared/project-logs.js';
import {
  defaultDesktopState,
  stateFromStoreSnapshot,
} from './desktop-state.js';
import { startEngine } from './engine-lifecycle.js';
import { logDesktop } from './main-log.js';
import type { MainRuntime } from './main-runtime.js';
import { ensureWorkspaceStorageLink } from './storage-locations.js';
import {
  loadWorkspaceSettings,
  reconcileMcpSettingsFromDisk,
  writeWorkspaceCompatFiles,
} from './workspace-config.js';

export async function applyWorkspace(
  runtime: MainRuntime,
  workspaceRoot: string,
): Promise<{ ok: boolean; workspaceRoot?: string; reason?: string }> {
  const { store } = runtime;
  try {
    ensureWorkspaceStorageLink(workspaceRoot);
    let settings = store.getWorkspaceSettings(workspaceRoot);
    if (!settings) {
      settings = loadWorkspaceSettings(workspaceRoot);
    }
    settings = reconcileMcpSettingsFromDisk(workspaceRoot, settings);
    store.setWorkspace(workspaceRoot, settings);
    store.saveSettings(workspaceRoot, settings);
    try {
      writeWorkspaceCompatFiles(workspaceRoot, settings);
    } catch (compatError) {
      logDesktop(
        runtime,
        'workspace',
        `compat_write_failed ${errorMessage(compatError)}`,
        { level: 'warn' },
        workspaceRoot,
      );
    }
    syncIndexMetaFromDisk(runtime, workspaceRoot);
    runtime.state = stateFromStoreSnapshot(
      store.snapshot(workspaceRoot),
      workspaceRoot,
    );
    await startEngine(runtime);
    logDesktop(
      runtime,
      'workspace',
      'applied',
      { extra: { workspaceRoot } },
      workspaceRoot,
    );
    return { ok: true, workspaceRoot };
  } catch (error) {
    const reason = errorMessage(error);
    logDesktop(
      runtime,
      'workspace',
      `apply_failed ${reason}`,
      {
        level: 'error',
        extra: { workspaceRoot, dbPath: store.dbPath },
      },
      workspaceRoot,
    );
    return { ok: false, reason };
  }
}

export function syncIndexMetaFromDisk(
  runtime: MainRuntime,
  workspaceRoot: string,
): void {
  try {
    const metaPath = join(workspaceRoot, '.mitii', 'index-runtime.json');
    if (!existsSync(metaPath)) return;
    const raw = JSON.parse(readFileSync(metaPath, 'utf8')) as {
      fileCount?: number;
      generatedAt?: string;
    };
    if (typeof raw.fileCount !== 'number') return;
    runtime.store.setIndexMeta(workspaceRoot, {
      fileCount: raw.fileCount,
      updatedAt:
        typeof raw.generatedAt === 'string'
          ? raw.generatedAt
          : new Date().toISOString(),
    });
  } catch (error) {
    logDesktop(
      runtime,
      'sqlite',
      `index_meta_sync_failed ${errorMessage(error)}`,
      { level: 'warn', extra: { workspaceRoot } },
      workspaceRoot,
    );
  }
}

/** Migrate the store and load persisted state + active workspace settings. */
export function hydrateRuntimeState(runtime: MainRuntime): void {
  const { store, userDataPath } = runtime;
  const fallbackCwd =
    process.env.MITII_DESKTOP_CWD?.trim() || process.cwd();

  try {
    store.migrate({
      userDataPath,
      workspaceRoot: fallbackCwd,
    });
    runtime.state = stateFromStoreSnapshot(
      store.snapshot(fallbackCwd),
      fallbackCwd,
    );
    logDesktop(
      runtime,
      'store',
      'migrate_ok',
      {
        extra: {
          dbPath: store.dbPath,
          workspaceRoot: runtime.state.workspaceRoot,
        },
      },
      fallbackCwd,
    );
  } catch (error) {
    const message = errorMessage(error);
    console.error(
      `[mitii-desktop] store migrate failed, using defaults: ${message}`,
    );
    logDesktop(
      runtime,
      'store',
      `migrate_failed ${message}`,
      {
        level: 'error',
        extra: { dbPath: store.dbPath, workspaceRoot: fallbackCwd },
      },
      fallbackCwd,
    );
    runtime.state = defaultDesktopState(fallbackCwd);
  }

  const { state } = runtime;
  if (!state.workspaceRoot) return;
  try {
    let settings = store.getWorkspaceSettings(state.workspaceRoot);
    if (!settings) {
      settings = loadWorkspaceSettings(state.workspaceRoot, state.settings);
    }
    settings = reconcileMcpSettingsFromDisk(state.workspaceRoot, settings);
    store.saveSettings(state.workspaceRoot, settings);
    state.settings = settings;
    try {
      writeWorkspaceCompatFiles(state.workspaceRoot, state.settings);
    } catch (compatError) {
      logDesktop(
        runtime,
        'settings',
        `compat_write_failed ${errorMessage(compatError)}`,
        { level: 'warn' },
      );
    }
    syncIndexMetaFromDisk(runtime, state.workspaceRoot);
  } catch (error) {
    logDesktop(
      runtime,
      'sqlite',
      `workspace_load_failed ${errorMessage(error)}`,
      {
        level: 'error',
        extra: {
          workspaceRoot: state.workspaceRoot,
          dbPath: store.dbPath,
        },
      },
    );
  }
}
