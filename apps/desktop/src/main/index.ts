/**
 * Electron main entry for Mitii Desktop.
 *
 * Authority split:
 * - Electron — process lifecycle, window, workspace/settings IPC, engine spawn
 * - Engine — MitiiClient / Decision Policy / tools
 * - Renderer — presentation only
 *
 * Persistence: `<userData>/mitii-desktop.sqlite`
 *   - global: connected repos, profiles, active workspace
 *   - per-workspace: full settings
 */

import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { DesktopShellSnapshot } from '../shared/bridge.js';
import {
  mergeDesktopSettings,
  settingsRequireEngineRestart,
  settingsToEngineEnv,
  DEFAULT_DESKTOP_SETTINGS,
  type DesktopSettings,
} from '../shared/settings.js';
import { generateEngineToken } from '../shared/engine-token.js';
import { isExternalBrowsableUrl } from '../shared/window-url-policy.js';
import {
  defaultDesktopState,
  stateFromStoreSnapshot,
  type DesktopPersistedState,
} from './desktop-state.js';
import {
  createDesktopStoreClient,
  type DesktopStoreClient,
} from './desktop-store-client.js';
import { installApplicationMenu } from './menu.js';
import {
  applyAppDataRedirectBeforeReady,
  ensureWorkspaceStorageLink,
  getStorageInfo,
  relocateWorkspaceData,
  resetWorkspaceDataToDefault,
  writeAppDataRedirect,
  writeRootStoragePath,
} from './storage-locations.js';
import { clearWorkspaceCache } from './clear-workspace-cache.js';
import {
  deleteThread,
  loadHistory,
  saveHistory,
} from '../engine/history.js';
import {
  clearStoredApiKey,
  clearStoredSearchApiKey,
  hasStoredApiKey,
  hasStoredSearchApiKey,
  readStoredApiKey,
  readStoredSearchApiKey,
  writeStoredApiKey,
  writeStoredSearchApiKey,
} from './secrets.js';
import { spawnDesktopEngine, type SpawnedEngine } from './engine-spawn.js';
import {
  createMainWindow,
  resolvePreloadPath,
  resolveRendererHtml,
} from './window.js';
import {
  loadWorkspaceSettings,
  reconcileMcpSettingsFromDisk,
  writeWorkspaceCompatFiles,
} from './workspace-config.js';
import {
  appendDesktopLog,
  errorMessage,
} from '../shared/project-logs.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const distRoot = join(__dirname, '..');

let mainWindow: BrowserWindow | null = null;
let engine: SpawnedEngine | null = null;
let engineToken: string | undefined;
let hostMode = '';
let state: DesktopPersistedState;
let userDataPath = '';
let store: DesktopStoreClient;

function desktopLogsDir(workspaceRoot?: string): string {
  const root =
    workspaceRoot?.trim() ||
    state?.workspaceRoot?.trim() ||
    process.env.MITII_DESKTOP_CWD?.trim() ||
    process.cwd();
  return getStorageInfo(root).logsPath;
}

function logDesktop(
  category: Parameters<typeof appendDesktopLog>[1],
  message: string,
  options?: Parameters<typeof appendDesktopLog>[3],
  workspaceRoot?: string,
): void {
  appendDesktopLog(desktopLogsDir(workspaceRoot), category, message, options);
}

async function stopEngine(): Promise<void> {
  if (engine) {
    await engine.stop();
    engine = null;
  }
}

async function startEngine(): Promise<void> {
  await stopEngine();
  engineToken = generateEngineToken();
  const apiKey = readStoredApiKey(userDataPath);
  const searchApiKey = readStoredSearchApiKey(userDataPath);
  const forceEcho =
    state.settings.provider.type === 'echo' ||
    process.env.MITII_FORCE_ECHO === '1' ||
    process.argv.includes('--echo');
  const env = settingsToEngineEnv(state.settings, {
    ...(forceEcho ? {} : apiKey ? { apiKey } : {}),
    ...(searchApiKey ? { searchApiKey } : {}),
  });
  if (forceEcho) env.MITII_FORCE_ECHO = '1';
  env.MITII_DESKTOP_STORE_PATH = store.dbPath;

  const logsPath = desktopLogsDir();
  try {
    engine = await spawnDesktopEngine({
      cwd: state.workspaceRoot,
      forceEcho,
      token: engineToken,
      env,
      logsPath,
    });
    hostMode = forceEcho ? 'echo' : 'host';
    logDesktop('engine', `started url=${engine.url} mode=${hostMode}`, {
      extra: { cwd: state.workspaceRoot },
    });
  } catch (error) {
    logDesktop('engine', `start_failed ${errorMessage(error)}`, {
      level: 'error',
      extra: { cwd: state.workspaceRoot, dbPath: store.dbPath },
      mirrorRuns: true,
    });
    throw error;
  }
}

function snapshot(): DesktopShellSnapshot {
  if (!engine) throw new Error('engine_not_ready');
  return {
    engineBaseUrl: engine.url,
    authToken: engineToken ?? '',
    workspaceRoot: state.workspaceRoot,
    recentWorkspaces: state.recentWorkspaces,
    appVersion: app.getVersion(),
    settings: state.settings,
    hasApiKey: hasStoredApiKey(userDataPath),
    hasSearchApiKey: hasStoredSearchApiKey(userDataPath),
    hostMode,
  };
}

function registerIpc(): void {
  ipcMain.handle('mitii:get-snapshot', () => snapshot());
  ipcMain.handle('mitii:get-engine-base-url', () => {
    if (!engine) throw new Error('engine_not_ready');
    return engine.url;
  });
  ipcMain.handle('mitii:get-engine-auth-token', () => engineToken ?? '');
  ipcMain.handle('mitii:get-workspace-root', () => state.workspaceRoot);
  ipcMain.handle('mitii:get-app-version', () => app.getVersion());
  ipcMain.handle('mitii:get-settings', () => state.settings);
  ipcMain.handle('mitii:open-external', async (_event, url: unknown) => {
    if (typeof url !== 'string' || !isExternalBrowsableUrl(url)) {
      return { ok: false, reason: 'blocked_url' };
    }
    await shell.openExternal(url);
    return { ok: true };
  });

  ipcMain.handle('mitii:reveal-in-folder', async (_event, absolutePath: unknown) => {
    if (typeof absolutePath !== 'string' || !absolutePath.trim()) {
      return { ok: false, reason: 'invalid_path' };
    }
    try {
      shell.showItemInFolder(absolutePath.trim());
      return { ok: true };
    } catch {
      return { ok: false, reason: 'reveal_failed' };
    }
  });

  ipcMain.handle('mitii:pick-workspace', async () => {
    const openOptions: Electron.OpenDialogOptions = {
      properties: ['openDirectory', 'createDirectory'],
    };
    const result = mainWindow
      ? await dialog.showOpenDialog(mainWindow, openOptions)
      : await dialog.showOpenDialog(openOptions);
    if (result.canceled || result.filePaths.length === 0) {
      return { ok: false, reason: 'cancelled' };
    }
    return applyWorkspace(result.filePaths[0]!);
  });

  ipcMain.handle('mitii:pick-files', async () => {
    const openOptions: Electron.OpenDialogOptions = {
      properties: ['openFile', 'multiSelections'],
    };
    const result = mainWindow
      ? await dialog.showOpenDialog(mainWindow, openOptions)
      : await dialog.showOpenDialog(openOptions);
    if (result.canceled || result.filePaths.length === 0) {
      return { ok: false, reason: 'cancelled' };
    }
    return { ok: true, paths: result.filePaths };
  });

  ipcMain.handle('mitii:pick-directory', async () => {
    const openOptions: Electron.OpenDialogOptions = {
      properties: ['openDirectory', 'createDirectory'],
    };
    const result = mainWindow
      ? await dialog.showOpenDialog(mainWindow, openOptions)
      : await dialog.showOpenDialog(openOptions);
    if (result.canceled || result.filePaths.length === 0) {
      return { ok: false, reason: 'cancelled' };
    }
    return { ok: true, path: result.filePaths[0] };
  });

  ipcMain.handle('mitii:get-storage-info', () =>
    getStorageInfo(state.workspaceRoot || process.cwd()),
  );

  ipcMain.handle('mitii:set-app-data-location', (_event, path: unknown) => {
    try {
      if (path === null || path === '') {
        writeAppDataRedirect(null);
        logDesktop('storage', 'app_data_redirect_cleared');
        return { ok: true, restartRequired: true };
      }
      if (typeof path !== 'string' || !path.trim()) {
        return { ok: false, reason: 'invalid_path' };
      }
      writeAppDataRedirect(path.trim());
      logDesktop('storage', 'app_data_redirect_set', {
        extra: { path: path.trim() },
      });
      return { ok: true, restartRequired: true };
    } catch (error) {
      const reason = errorMessage(error);
      logDesktop('storage', `app_data_redirect_failed ${reason}`, {
        level: 'error',
      });
      return { ok: false, reason };
    }
  });

  ipcMain.handle('mitii:set-root-storage-location', (_event, path: unknown) => {
    try {
      if (path === null || path === '') {
        writeRootStoragePath(null);
        if (state.workspaceRoot) {
          ensureWorkspaceStorageLink(state.workspaceRoot);
        }
        logDesktop('storage', 'root_storage_cleared');
        return { ok: true };
      }
      if (typeof path !== 'string' || !path.trim()) {
        return { ok: false, reason: 'invalid_path' };
      }
      writeRootStoragePath(path.trim());
      if (state.workspaceRoot) {
        ensureWorkspaceStorageLink(state.workspaceRoot);
      }
      logDesktop('storage', 'root_storage_set', {
        extra: { path: path.trim() },
      });
      return { ok: true };
    } catch (error) {
      const reason = errorMessage(error);
      logDesktop('storage', `root_storage_failed ${reason}`, {
        level: 'error',
      });
      return { ok: false, reason };
    }
  });

  ipcMain.handle(
    'mitii:set-workspace-data-location',
    (_event, path: unknown) => {
      const root = state.workspaceRoot?.trim();
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

  ipcMain.handle(
    'mitii:list-workspace-chat-summaries',
    (_event, workspaceRoots: unknown) => {
      if (!Array.isArray(workspaceRoots)) return [];
      return workspaceRoots
        .filter((root): root is string => typeof root === 'string' && Boolean(root.trim()))
        .map((workspaceRoot) => {
          const store = loadHistory(workspaceRoot.trim());
          return {
            workspaceRoot: workspaceRoot.trim(),
            threads: store.threads.map((t) => ({
              id: t.id,
              title: t.title,
              updatedAt: t.updatedAt,
            })),
          };
        });
    },
  );

  ipcMain.handle(
    'mitii:delete-workspace-chat',
    (_event, workspaceRoot: unknown, threadId: unknown) => {
      if (typeof workspaceRoot !== 'string' || !workspaceRoot.trim()) {
        return { ok: false, reason: 'invalid_workspace' };
      }
      if (typeof threadId !== 'string' || !threadId.trim()) {
        return { ok: false, reason: 'invalid_thread' };
      }
      try {
        const root = workspaceRoot.trim();
        const next = deleteThread(loadHistory(root), threadId.trim());
        saveHistory(root, next);
        return { ok: true };
      } catch (error) {
        return {
          ok: false,
          reason: error instanceof Error ? error.message : String(error),
        };
      }
    },
  );

  ipcMain.handle('mitii:set-workspace', async (_event, workspaceRoot: unknown) => {
    if (typeof workspaceRoot !== 'string' || !workspaceRoot.trim()) {
      return { ok: false, reason: 'invalid_workspace' };
    }
    return applyWorkspace(workspaceRoot.trim());
  });

  ipcMain.handle(
    'mitii:forget-workspace',
    async (_event, workspaceRoot: unknown) => {
      if (typeof workspaceRoot !== 'string' || !workspaceRoot.trim()) {
        return { ok: false, reason: 'invalid_workspace' };
      }
      try {
        const path = workspaceRoot.trim();
        const { nextActive, snapshot: nextSnap } = store.forgetWorkspace(path);
        if (nextActive) {
          const applied = await applyWorkspace(nextActive);
          if (!applied.ok) {
            return { ok: false, reason: applied.reason, nextActive };
          }
          return { ok: true, nextActive };
        }
        await stopEngine();
        state = stateFromStoreSnapshot(nextSnap, '');
        return { ok: true, nextActive: '' };
      } catch (error) {
        return {
          ok: false,
          reason: error instanceof Error ? error.message : String(error),
        };
      }
    },
  );

  ipcMain.handle('mitii:clear-workspace-cache', async () => {
    const root = state.workspaceRoot?.trim();
    if (!root) return { ok: false, reason: 'no_workspace' };
    try {
      const cleared = clearWorkspaceCache(root);
      if (!cleared.ok) {
        return { ok: false, reason: cleared.reason, removed: cleared.removed };
      }
      const defaults = mergeDesktopSettings(DEFAULT_DESKTOP_SETTINGS);
      state.settings = defaults;
      store.saveSettings(root, defaults);
      writeWorkspaceCompatFiles(root, defaults, { replaceMcp: true });
      ensureWorkspaceStorageLink(root);
      await startEngine();
      logDesktop('storage', 'workspace_cache_cleared', {
        extra: { workspaceRoot: root, removed: cleared.removed },
      });
      return { ok: true, removed: cleared.removed };
    } catch (error) {
      const reason = errorMessage(error);
      logDesktop('storage', `clear_cache_failed ${reason}`, {
        level: 'error',
      });
      return { ok: false, reason };
    }
  });

  ipcMain.handle('mitii:save-settings', async (_event, input: unknown) => {
    if (!input || typeof input !== 'object') {
      logDesktop('settings', 'save_failed invalid_payload', { level: 'error' });
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
      logDesktop('settings', 'save_failed missing_settings', { level: 'error' });
      return { ok: false, reason: 'missing_settings' };
    }
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
        await startEngine();
      }
      logDesktop('settings', 'save_ok', {
        extra: {
          workspaceRoot: state.workspaceRoot,
          restarted: restart,
          providerType: next.provider.type,
        },
      });
      return { ok: true, restarted: restart };
    } catch (error) {
      const reason = errorMessage(error);
      logDesktop('settings', `save_failed ${reason}`, {
        level: 'error',
        extra: {
          workspaceRoot: state.workspaceRoot,
          dbPath: store.dbPath,
        },
      });
      return { ok: false, reason };
    }
  });

  ipcMain.handle('mitii:restart-engine', async () => {
    try {
      await startEngine();
      return { ok: true };
    } catch (error) {
      const reason = errorMessage(error);
      logDesktop('engine', `restart_failed ${reason}`, { level: 'error' });
      return { ok: false, reason };
    }
  });
}

async function applyWorkspace(
  workspaceRoot: string,
): Promise<{ ok: boolean; workspaceRoot?: string; reason?: string }> {
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
        'workspace',
        `compat_write_failed ${errorMessage(compatError)}`,
        { level: 'warn' },
        workspaceRoot,
      );
    }
    syncIndexMetaFromDisk(workspaceRoot);
    state = stateFromStoreSnapshot(
      store.snapshot(workspaceRoot),
      workspaceRoot,
    );
    await startEngine();
    logDesktop('workspace', 'applied', {
      extra: { workspaceRoot },
    }, workspaceRoot);
    return { ok: true, workspaceRoot };
  } catch (error) {
    const reason = errorMessage(error);
    logDesktop(
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

function syncIndexMetaFromDisk(workspaceRoot: string): void {
  try {
    const metaPath = join(workspaceRoot, '.mitii', 'index-runtime.json');
    if (!existsSync(metaPath)) return;
    const raw = JSON.parse(readFileSync(metaPath, 'utf8')) as {
      fileCount?: number;
      generatedAt?: string;
    };
    if (typeof raw.fileCount !== 'number') return;
    store.setIndexMeta(workspaceRoot, {
      fileCount: raw.fileCount,
      updatedAt:
        typeof raw.generatedAt === 'string'
          ? raw.generatedAt
          : new Date().toISOString(),
    });
  } catch (error) {
    logDesktop(
      'sqlite',
      `index_meta_sync_failed ${errorMessage(error)}`,
      { level: 'warn', extra: { workspaceRoot } },
      workspaceRoot,
    );
  }
}

async function boot(): Promise<void> {
  userDataPath = app.getPath('userData');
  store = createDesktopStoreClient({ userDataPath, distRoot });

  const fallbackCwd =
    process.env.MITII_DESKTOP_CWD?.trim() || process.cwd();

  try {
    store.migrate({
      userDataPath,
      workspaceRoot: fallbackCwd,
    });
    state = stateFromStoreSnapshot(store.snapshot(fallbackCwd), fallbackCwd);
    logDesktop('store', 'migrate_ok', {
      extra: { dbPath: store.dbPath, workspaceRoot: state.workspaceRoot },
    }, fallbackCwd);
  } catch (error) {
    const message = errorMessage(error);
    console.error(
      `[mitii-desktop] store migrate failed, using defaults: ${message}`,
    );
    logDesktop(
      'store',
      `migrate_failed ${message}`,
      {
        level: 'error',
        extra: { dbPath: store.dbPath, workspaceRoot: fallbackCwd },
      },
      fallbackCwd,
    );
    state = defaultDesktopState(fallbackCwd);
  }

  if (state.workspaceRoot) {
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
          'settings',
          `compat_write_failed ${errorMessage(compatError)}`,
          { level: 'warn' },
        );
      }
      syncIndexMetaFromDisk(state.workspaceRoot);
    } catch (error) {
      logDesktop('sqlite', `workspace_load_failed ${errorMessage(error)}`, {
        level: 'error',
        extra: {
          workspaceRoot: state.workspaceRoot,
          dbPath: store.dbPath,
        },
      });
    }
  }

  await startEngine();
  registerIpc();
  installApplicationMenu(() => mainWindow);

  mainWindow = createMainWindow({
    preloadPath: resolvePreloadPath(distRoot),
    rendererHtmlPath: resolveRendererHtml(distRoot),
    devServerUrl: process.env.MITII_DESKTOP_DEV_SERVER,
  });

  logDesktop('boot', 'ready', {
    extra: {
      store: store.dbPath,
      engine: engine?.url,
      cwd: state.workspaceRoot,
      logsPath: desktopLogsDir(),
    },
  });
  console.error(
    `[mitii-desktop] store=${store.dbPath} engine=${engine?.url} cwd=${state.workspaceRoot}`,
  );

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

async function shutdown(): Promise<void> {
  await stopEngine();
}

// Apply custom app-data path before any userData-dependent APIs.
applyAppDataRedirectBeforeReady();

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(() => {
    void boot().catch((error) => {
      const message = errorMessage(error);
      console.error(`[mitii-desktop] boot failed: ${message}`);
      try {
        appendDesktopLog(
          getStorageInfo(
            process.env.MITII_DESKTOP_CWD?.trim() || process.cwd(),
          ).logsPath,
          'boot',
          `failed ${message}`,
          { level: 'error' },
        );
      } catch {
        /* ignore */
      }
      app.exit(1);
    });
  });

  app.on('window-all-closed', () => {
    void shutdown().finally(() => {
      if (process.platform !== 'darwin') app.quit();
    });
  });

  app.on('before-quit', () => {
    void shutdown();
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      void boot();
    }
  });
}
