/**
 * Preload: expose a narrow typed bridge (contextIsolation + sandbox).
 */

import { contextBridge, ipcRenderer } from 'electron';

import {
  MITII_DESKTOP_BRIDGE_KEY,
  type MitiiDesktopBridge,
} from '../shared/bridge.js';
import type { DesktopSettings } from '../shared/settings.js';

const bridge: MitiiDesktopBridge = {
  getSnapshot: () => ipcRenderer.invoke('mitii:get-snapshot'),
  getEngineBaseUrl: () => ipcRenderer.invoke('mitii:get-engine-base-url'),
  getEngineAuthToken: () => ipcRenderer.invoke('mitii:get-engine-auth-token'),
  getWorkspaceRoot: () => ipcRenderer.invoke('mitii:get-workspace-root'),
  getAppVersion: () => ipcRenderer.invoke('mitii:get-app-version'),
  openExternal: (url: string) => ipcRenderer.invoke('mitii:open-external', url),
  pickWorkspace: () => ipcRenderer.invoke('mitii:pick-workspace'),
  pickFiles: () => ipcRenderer.invoke('mitii:pick-files'),
  pickDirectory: () => ipcRenderer.invoke('mitii:pick-directory'),
  setWorkspace: (workspaceRoot: string) =>
    ipcRenderer.invoke('mitii:set-workspace', workspaceRoot),
  getSettings: () => ipcRenderer.invoke('mitii:get-settings'),
  saveSettings: (input: {
    settings: DesktopSettings;
    apiKey?: string;
    clearApiKey?: boolean;
    searchApiKey?: string;
    clearSearchApiKey?: boolean;
  }) => ipcRenderer.invoke('mitii:save-settings', input),
  restartEngine: () => ipcRenderer.invoke('mitii:restart-engine'),
  revealInFolder: (absolutePath: string) =>
    ipcRenderer.invoke('mitii:reveal-in-folder', absolutePath),
  getStorageInfo: () => ipcRenderer.invoke('mitii:get-storage-info'),
  setAppDataLocation: (path: string | null) =>
    ipcRenderer.invoke('mitii:set-app-data-location', path),
  setRootStorageLocation: (path: string | null) =>
    ipcRenderer.invoke('mitii:set-root-storage-location', path),
  setWorkspaceDataLocation: (path: string | null) =>
    ipcRenderer.invoke('mitii:set-workspace-data-location', path),
  listWorkspaceChatSummaries: (workspaceRoots: string[]) =>
    ipcRenderer.invoke('mitii:list-workspace-chat-summaries', workspaceRoots),
  deleteWorkspaceChat: (workspaceRoot: string, threadId: string) =>
    ipcRenderer.invoke('mitii:delete-workspace-chat', workspaceRoot, threadId),
};

contextBridge.exposeInMainWorld(MITII_DESKTOP_BRIDGE_KEY, bridge);
