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

import { app, BrowserWindow } from 'electron';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { appendDesktopLog, errorMessage } from '../shared/project-logs.js';
import { createDesktopStoreClient } from './desktop-store-client.js';
import { startEngine, stopEngine } from './engine-lifecycle.js';
import { desktopLogsDir, logDesktop } from './main-log.js';
import { createMainRuntime } from './main-runtime.js';
import { installApplicationMenu } from './menu.js';
import { registerIpc } from './register-ipc.js';
import {
  applyAppDataRedirectBeforeReady,
  getStorageInfo,
} from './storage-locations.js';
import { hydrateRuntimeState } from './workspace-apply.js';
import {
  createMainWindow,
  resolvePreloadPath,
  resolveRendererHtml,
} from './window.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const runtime = createMainRuntime(join(__dirname, '..'));

async function boot(): Promise<void> {
  runtime.userDataPath = app.getPath('userData');
  runtime.store = createDesktopStoreClient({
    userDataPath: runtime.userDataPath,
    distRoot: runtime.distRoot,
  });
  const { store, distRoot } = runtime;

  hydrateRuntimeState(runtime);
  const { state } = runtime;

  await startEngine(runtime);
  registerIpc(runtime);
  installApplicationMenu(() => runtime.mainWindow);

  const mainWindow = createMainWindow({
    preloadPath: resolvePreloadPath(distRoot),
    rendererHtmlPath: resolveRendererHtml(distRoot),
    devServerUrl: process.env.MITII_DESKTOP_DEV_SERVER,
  });
  runtime.mainWindow = mainWindow;

  logDesktop(runtime, 'boot', 'ready', {
    extra: {
      store: store.dbPath,
      engine: runtime.engine?.url,
      cwd: state.workspaceRoot,
      logsPath: desktopLogsDir(runtime),
    },
  });
  console.error(
    `[mitii-desktop] store=${store.dbPath} engine=${runtime.engine?.url} cwd=${state.workspaceRoot}`,
  );

  mainWindow.on('closed', () => {
    runtime.mainWindow = null;
  });
}

async function shutdown(): Promise<void> {
  await stopEngine(runtime);
}

// Apply custom app-data path before any userData-dependent APIs.
applyAppDataRedirectBeforeReady();

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const { mainWindow } = runtime;
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
