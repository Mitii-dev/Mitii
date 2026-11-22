import { ipcMain } from 'electron';

import { errorMessage } from '../shared/project-logs.js';
import {
  DEFAULT_DESKTOP_SETTINGS,
  mergeDesktopSettings,
} from '../shared/settings.js';
import { clearWorkspaceCache } from './clear-workspace-cache.js';
import { startEngine } from './engine-lifecycle.js';
import { logDesktop } from './main-log.js';
import type { MainRuntime } from './main-runtime.js';
import {
  ensureWorkspaceStorageLink,
  getStorageInfo,
  relocateWorkspaceData,
  resetWorkspaceDataToDefault,
  writeAppDataRedirect,
  writeRootStoragePath,
} from './storage-locations.js';
import { writeWorkspaceCompatFiles } from './workspace-config.js';

export function registerStorageIpc(runtime: MainRuntime): void {
  ipcMain.handle('mitii:get-storage-info', () =>
    getStorageInfo(runtime.state.workspaceRoot || process.cwd()),
  );

  ipcMain.handle('mitii:set-app-data-location', (_event, path: unknown) => {
    try {
      if (path === null || path === '') {
        writeAppDataRedirect(null);
        logDesktop(runtime, 'storage', 'app_data_redirect_cleared');
        return { ok: true, restartRequired: true };
      }
      if (typeof path !== 'string' || !path.trim()) {
        return { ok: false, reason: 'invalid_path' };
      }
      writeAppDataRedirect(path.trim());
      logDesktop(runtime, 'storage', 'app_data_redirect_set', {
        extra: { path: path.trim() },
      });
      return { ok: true, restartRequired: true };
    } catch (error) {
      const reason = errorMessage(error);
      logDesktop(runtime, 'storage', `app_data_redirect_failed ${reason}`, {
        level: 'error',
      });
      return { ok: false, reason };
    }
  });

  ipcMain.handle('mitii:set-root-storage-location', (_event, path: unknown) => {
    try {
      if (path === null || path === '') {
        writeRootStoragePath(null);
        if (runtime.state.workspaceRoot) {
          ensureWorkspaceStorageLink(runtime.state.workspaceRoot);
        }
        logDesktop(runtime, 'storage', 'root_storage_cleared');
        return { ok: true };
      }
      if (typeof path !== 'string' || !path.trim()) {
        return { ok: false, reason: 'invalid_path' };
      }
      writeRootStoragePath(path.trim());
      if (runtime.state.workspaceRoot) {
        ensureWorkspaceStorageLink(runtime.state.workspaceRoot);
      }
      logDesktop(runtime, 'storage', 'root_storage_set', {
        extra: { path: path.trim() },
      });
      return { ok: true };
    } catch (error) {
      const reason = errorMessage(error);
      logDesktop(runtime, 'storage', `root_storage_failed ${reason}`, {
        level: 'error',
      });
      return { ok: false, reason };
    }
  });

  ipcMain.handle(
    'mitii:set-workspace-data-location',
    (_event, path: unknown) => {
      const root = runtime.state.workspaceRoot?.trim();
      if (!root) return { ok: false, reason: 'no_workspace' };
      if (path === null || path === '') {
        return resetWorkspaceDataToDefault(root);
      }
      if (typeof path !== 'string' || !path.trim()) {
        return { ok: false, reason: 'invalid_path' };
      }
      return relocateWorkspaceData(root, path.trim());
    },
  );

  ipcMain.handle('mitii:clear-workspace-cache', async () => {
    const root = runtime.state.workspaceRoot?.trim();
    if (!root) return { ok: false, reason: 'no_workspace' };
    try {
      const cleared = clearWorkspaceCache(root);
      if (!cleared.ok) {
        return { ok: false, reason: cleared.reason, removed: cleared.removed };
      }
      const defaults = mergeDesktopSettings(DEFAULT_DESKTOP_SETTINGS);
      runtime.state.settings = defaults;
      runtime.store.saveSettings(root, defaults);
      writeWorkspaceCompatFiles(root, defaults, { replaceMcp: true });
      ensureWorkspaceStorageLink(root);
      await startEngine(runtime);
      logDesktop(runtime, 'storage', 'workspace_cache_cleared', {
        extra: { workspaceRoot: root, removed: cleared.removed },
      });
      return { ok: true, removed: cleared.removed };
    } catch (error) {
      const reason = errorMessage(error);
      logDesktop(runtime, 'storage', `clear_cache_failed ${reason}`, {
        level: 'error',
      });
      return { ok: false, reason };
    }
  });
}
