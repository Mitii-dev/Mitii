import { app, ipcMain, shell } from 'electron';

import { errorMessage } from '../shared/project-logs.js';
import { isExternalBrowsableUrl } from '../shared/window-url-policy.js';
import { snapshot, startEngine } from './engine-lifecycle.js';
import { logDesktop } from './main-log.js';
import type { MainRuntime } from './main-runtime.js';

export function registerShellIpc(runtime: MainRuntime): void {
  ipcMain.handle('mitii:get-snapshot', () => snapshot(runtime));
  ipcMain.handle('mitii:get-engine-base-url', () => {
    if (!runtime.engine) throw new Error('engine_not_ready');
    return runtime.engine.url;
  });
  ipcMain.handle(
    'mitii:get-engine-auth-token',
    () => runtime.engineToken ?? '',
  );
  ipcMain.handle('mitii:get-workspace-root', () => runtime.state.workspaceRoot);
  ipcMain.handle('mitii:get-app-version', () => app.getVersion());
  ipcMain.handle('mitii:get-shell-chrome', () => ({
    platform: process.platform,
    fullscreen: runtime.mainWindow?.isFullScreen() ?? false,
  }));
  ipcMain.handle('mitii:open-external', async (_event, url: unknown) => {
    if (typeof url !== 'string' || !isExternalBrowsableUrl(url)) {
      return { ok: false, reason: 'blocked_url' };
    }
    await shell.openExternal(url);
    return { ok: true };
  });

  ipcMain.handle(
    'mitii:reveal-in-folder',
    async (_event, absolutePath: unknown) => {
      if (typeof absolutePath !== 'string' || !absolutePath.trim()) {
        return { ok: false, reason: 'invalid_path' };
      }
      try {
        shell.showItemInFolder(absolutePath.trim());
        return { ok: true };
      } catch {
        return { ok: false, reason: 'reveal_failed' };
      }
    },
  );

  ipcMain.handle('mitii:restart-engine', async () => {
    try {
      await startEngine(runtime);
      return { ok: true };
    } catch (error) {
      const reason = errorMessage(error);
      logDesktop(runtime, 'engine', `restart_failed ${reason}`, {
        level: 'error',
      });
      return { ok: false, reason };
    }
  });
}
