import { dialog, ipcMain } from 'electron';

import type { MainRuntime } from './main-runtime.js';
import { applyWorkspace } from './workspace-apply.js';

function showOpenDialog(
  runtime: MainRuntime,
  openOptions: Electron.OpenDialogOptions,
): Promise<Electron.OpenDialogReturnValue> {
  return runtime.mainWindow
    ? dialog.showOpenDialog(runtime.mainWindow, openOptions)
    : dialog.showOpenDialog(openOptions);
}

export function registerDialogsIpc(runtime: MainRuntime): void {
  ipcMain.handle('mitii:pick-workspace', async () => {
    const result = await showOpenDialog(runtime, {
      properties: ['openDirectory', 'createDirectory'],
    });
    if (result.canceled || result.filePaths.length === 0) {
      return { ok: false, reason: 'cancelled' };
    }
    return applyWorkspace(runtime, result.filePaths[0]!);
  });

  ipcMain.handle('mitii:pick-files', async () => {
    const result = await showOpenDialog(runtime, {
      properties: ['openFile', 'multiSelections'],
    });
    if (result.canceled || result.filePaths.length === 0) {
      return { ok: false, reason: 'cancelled' };
    }
    return { ok: true, paths: result.filePaths };
  });

  ipcMain.handle('mitii:pick-directory', async () => {
    const result = await showOpenDialog(runtime, {
      properties: ['openDirectory', 'createDirectory'],
    });
    if (result.canceled || result.filePaths.length === 0) {
      return { ok: false, reason: 'cancelled' };
    }
    return { ok: true, path: result.filePaths[0] };
  });
}
