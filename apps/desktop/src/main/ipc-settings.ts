import { ipcMain } from 'electron';

import { errorMessage } from '../shared/project-logs.js';
import {
  mergeDesktopSettings,
  settingsRequireEngineRestart,
  type DesktopSettings,
} from '../shared/settings.js';
import { startEngine } from './engine-lifecycle.js';
import { logDesktop } from './main-log.js';
import type { MainRuntime } from './main-runtime.js';
import {
  clearStoredApiKey,
  clearStoredSearchApiKey,
  writeStoredApiKey,
  writeStoredSearchApiKey,
} from './secrets.js';
import {
  reconcileMcpSettingsFromDisk,
  writeWorkspaceCompatFiles,
} from './workspace-config.js';

export function registerSettingsIpc(runtime: MainRuntime): void {
  ipcMain.handle('mitii:get-settings', () => runtime.state.settings);

  ipcMain.handle('mitii:save-settings', async (_event, input: unknown) => {
    if (!input || typeof input !== 'object') {
      logDesktop(runtime, 'settings', 'save_failed invalid_payload', {
        level: 'error',
      });
      return { ok: false, reason: 'invalid_payload' };
    }
    const record = input as {
      settings?: DesktopSettings;
      apiKey?: string;
      clearApiKey?: boolean;
      searchApiKey?: string;
      clearSearchApiKey?: boolean;
    };
    if (!record.settings) {
      logDesktop(runtime, 'settings', 'save_failed missing_settings', {
        level: 'error',
      });
      return { ok: false, reason: 'missing_settings' };
    }
    const { state, store, userDataPath } = runtime;
    try {
      const previous = state.settings;
      let next = mergeDesktopSettings(record.settings);
      const apiKeyChanged = Boolean(
        record.clearApiKey ||
          (typeof record.apiKey === 'string' && record.apiKey.trim()),
      );
      const searchApiKeyChanged = Boolean(
        record.clearSearchApiKey ||
          (typeof record.searchApiKey === 'string' &&
            record.searchApiKey.trim()),
      );
      const restart = settingsRequireEngineRestart(previous, next, {
        apiKeyChanged,
        searchApiKeyChanged,
      });

      // MCP installs live in `.mitii/mcp.json`; adopt them when the renderer
      // still holds the empty default so Save does not wipe mongo/sqlite pins.
      next = reconcileMcpSettingsFromDisk(state.workspaceRoot, next);
      state.settings = next;
      store.saveSettings(state.workspaceRoot, state.settings);
      try {
        writeWorkspaceCompatFiles(state.workspaceRoot, state.settings);
      } catch (compatError) {
        logDesktop(
          runtime,
          'settings',
          `compat_write_failed ${errorMessage(compatError)}`,
          { level: 'warn', extra: { workspaceRoot: state.workspaceRoot } },
        );
      }
      if (record.clearApiKey) clearStoredApiKey(userDataPath);
      else if (typeof record.apiKey === 'string' && record.apiKey.trim()) {
        writeStoredApiKey(userDataPath, record.apiKey);
      }
      if (record.clearSearchApiKey) clearStoredSearchApiKey(userDataPath);
      else if (
        typeof record.searchApiKey === 'string' &&
        record.searchApiKey.trim()
      ) {
        writeStoredSearchApiKey(userDataPath, record.searchApiKey);
      }
      if (restart) {
        await startEngine(runtime);
      }
      logDesktop(runtime, 'settings', 'save_ok', {
        extra: {
          workspaceRoot: state.workspaceRoot,
          restarted: restart,
          providerType: next.provider.type,
        },
      });
      return { ok: true, restarted: restart };
    } catch (error) {
      const reason = errorMessage(error);
      logDesktop(runtime, 'settings', `save_failed ${reason}`, {
        level: 'error',
        extra: {
          workspaceRoot: state.workspaceRoot,
          dbPath: store.dbPath,
        },
      });
      return { ok: false, reason };
    }
  });
}
