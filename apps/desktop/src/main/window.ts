/**
 * Electron BrowserWindow factory.
 */

import {
  BrowserWindow,
  shell,
  type BrowserWindowConstructorOptions,
} from 'electron';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  isExternalBrowsableUrl,
  isLoopbackAppUrl,
} from '../shared/window-url-policy.js';

export interface CreateMainWindowOptions {
  preloadPath: string;
  rendererHtmlPath: string;
  /** Dev: load Vite URL instead of file. */
  devServerUrl?: string;
  show?: boolean;
}

export function createMainWindow(
  options: CreateMainWindowOptions,
): BrowserWindow {
  const opts: BrowserWindowConstructorOptions = {
    width: 1280,
    height: 840,
    minWidth: 960,
    minHeight: 640,
    show: options.show ?? false,
    title: 'Mitii',
    backgroundColor: '#0b0d10',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    trafficLightPosition: { x: 16, y: 16 },
    webPreferences: {
      preload: options.preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  };

  const win = new BrowserWindow(opts);

  win.webContents.on('preload-error', (_event, preloadPath, error) => {
    console.error(
      `[mitii-desktop] preload failed path=${preloadPath}: ${error.message}`,
    );
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isLoopbackAppUrl(url)) {
      return { action: 'allow' };
    }
    if (isExternalBrowsableUrl(url)) {
      void shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  win.once('ready-to-show', () => {
    win.show();
  });

  if (options.devServerUrl) {
    void win.loadURL(options.devServerUrl);
  } else {
    void win.loadURL(pathToFileURL(options.rendererHtmlPath).href);
  }

  return win;
}

export function resolveRendererHtml(distRoot: string): string {
  return join(distRoot, 'renderer', 'index.html');
}

export function resolvePreloadPath(distRoot: string): string {
  return join(distRoot, 'preload', 'index.cjs');
}
