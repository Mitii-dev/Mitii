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
  settingsToEngineEnv,
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
  writeWorkspaceCompatFiles,
} from './workspace-config.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const distRoot = join(__dirname, '..');

let mainWindow: BrowserWindow | null = null;
let engine: SpawnedEngine | null = null;
let engineToken: string | undefined;
let hostMode = '';
let state: DesktopPersistedState;
let userDataPath = '';
let store: DesktopStoreClient;

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

  const logsPath = getStorageInfo(state.workspaceRoot || process.cwd()).logsPath;
  engine = await spawnDesktopEngine({
    cwd: state.workspaceRoot,
    forceEcho,
    token: engineToken,
    env,
    logsPath,
  });
  hostMode = forceEcho ? 'echo' : 'host';
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
        return { ok: true, restartRequired: true };
      }
      if (typeof path !== 'string' || !path.trim()) {
        return { ok: false, reason: 'invalid_path' };
      }
      writeAppDataRedirect(path.trim());
      return { ok: true, restartRequired: true };
    } catch (error) {
      return {
        ok: false,
        reason: error instanceof Error ? error.message : String(error),
      };
    }
  });

  ipcMain.handle('mitii:set-root-storage-location', (_event, path: unknown) => {
    try {
      if (path === null || path === '') {
        writeRootStoragePath(null);
        if (state.workspaceRoot) {
          ensureWorkspaceStorageLink(state.workspaceRoot);
        }
        return { ok: true };
      }
      if (typeof path !== 'string' || !path.trim()) {
        return { ok: false, reason: 'invalid_path' };
      }
      writeRootStoragePath(path.trim());
      if (state.workspaceRoot) {
        ensureWorkspaceStorageLink(state.workspaceRoot);
      }
      return { ok: true };
    } catch (error) {
      return {
        ok: false,
        reason: error instanceof Error ? error.message : String(error),
      };
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

  ipcMain.handle('mitii:save-settings', async (_event, input: unknown) => {
    if (!input || typeof input !== 'object') {
      return { ok: false, reason: 'invalid_payload' };
    }
    const record = input as {
      settings?: DesktopSettings;
      apiKey?: string;
      clearApiKey?: boolean;
      searchApiKey?: string;
      clearSearchApiKey?: boolean;
    };
    if (!record.settings) return { ok: false, reason: 'missing_settings' };
    try {
      state.settings = mergeDesktopSettings(record.settings);
      store.saveSettings(state.workspaceRoot, state.settings);
      writeWorkspaceCompatFiles(state.workspaceRoot, state.settings);
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
      await startEngine();
      return { ok: true };
    } catch (error) {
      return {
        ok: false,
        reason: error instanceof Error ? error.message : String(error),
      };
    }
  });

  ipcMain.handle('mitii:restart-engine', async () => {
    try {
      await startEngine();
      return { ok: true };
    } catch (error) {
      return {
        ok: false,
        reason: error instanceof Error ? error.message : String(error),
      };
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
    store.setWorkspace(workspaceRoot, settings);
    store.saveSettings(workspaceRoot, settings);
    try {
      writeWorkspaceCompatFiles(workspaceRoot, settings);
    } catch {
      /* ignore */
    }
    syncIndexMetaFromDisk(workspaceRoot);
    state = stateFromStoreSnapshot(
      store.snapshot(workspaceRoot),
      workspaceRoot,
    );
    await startEngine();
    return { ok: true, workspaceRoot };
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof Error ? error.message : String(error),
    };
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
  } catch {
    /* ignore */
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
  } catch (error) {
    console.error(
      `[mitii-desktop] store migrate failed, using defaults: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    state = defaultDesktopState(fallbackCwd);
  }

  if (state.workspaceRoot) {
    let settings = store.getWorkspaceSettings(state.workspaceRoot);
    if (!settings) {
      settings = loadWorkspaceSettings(state.workspaceRoot, state.settings);
      store.saveSettings(state.workspaceRoot, settings);
    }
    state.settings = settings;
    try {
      writeWorkspaceCompatFiles(state.workspaceRoot, state.settings);
    } catch {
      /* ignore */
    }
    syncIndexMetaFromDisk(state.workspaceRoot);
  }

  await startEngine();
  registerIpc();
  installApplicationMenu(() => mainWindow);

  mainWindow = createMainWindow({
    preloadPath: resolvePreloadPath(distRoot),
    rendererHtmlPath: resolveRendererHtml(distRoot),
    devServerUrl: process.env.MITII_DESKTOP_DEV_SERVER,
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
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[mitii-desktop] boot failed: ${message}`);
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
