/**
 * Electron preload ↔ renderer bridge contract.
 * Renderer never reaches for Node; native power arrives through this surface.
 */

import type { DesktopSettings } from './settings.js';

export const MITII_DESKTOP_BRIDGE_KEY = 'mitiiDesktop' as const;

export interface DesktopShellSnapshot {
  engineBaseUrl: string;
  authToken: string;
  workspaceRoot: string;
  recentWorkspaces: string[];
  appVersion: string;
  settings: DesktopSettings;
  hasApiKey: boolean;
  hasSearchApiKey: boolean;
  hostMode: string;
}

export interface DesktopStorageInfo {
  appDataPath: string;
  appDataDefaultPath: string;
  appDataCustom: boolean;
  rootStoragePath: string;
  rootStorageCustom: boolean;
  rootStorageDefaultPath: string;
  workspaceDataPath: string;
  workspaceDataTarget: string;
  workspaceDataIsLink: boolean;
  projectFolderName: string;
  projectSlug: string;
  usesRootStorage: boolean;
  logsPath: string;
  workspaceId: string;
  restartRequiredForAppData: boolean;
}

/** Lightweight chat rows for the workspace-grouped sidebar (main-process FS). */
export interface WorkspaceChatThreadSummary {
  id: string;
  title: string;
  updatedAt: string;
}

export interface WorkspaceChatSummary {
  workspaceRoot: string;
  threads: WorkspaceChatThreadSummary[];
}

export interface MitiiDesktopBridge {
  getSnapshot: () => Promise<DesktopShellSnapshot>;
  getEngineBaseUrl: () => Promise<string>;
  getEngineAuthToken: () => Promise<string>;
  getWorkspaceRoot: () => Promise<string>;
  getAppVersion: () => Promise<string>;
  openExternal: (url: string) => Promise<{ ok: boolean; reason?: string }>;
  pickWorkspace: () => Promise<{
    ok: boolean;
    workspaceRoot?: string;
    reason?: string;
  }>;
  pickFiles: () => Promise<{
    ok: boolean;
    paths?: string[];
    reason?: string;
  }>;
  pickDirectory: () => Promise<{
    ok: boolean;
    path?: string;
    reason?: string;
  }>;
  setWorkspace: (
    workspaceRoot: string,
  ) => Promise<{ ok: boolean; reason?: string }>;
  getSettings: () => Promise<DesktopSettings>;
  saveSettings: (input: {
    settings: DesktopSettings;
    apiKey?: string;
    clearApiKey?: boolean;
    searchApiKey?: string;
    clearSearchApiKey?: boolean;
  }) => Promise<{ ok: boolean; reason?: string }>;
  restartEngine: () => Promise<{ ok: boolean; reason?: string }>;
  revealInFolder: (
    absolutePath: string,
  ) => Promise<{ ok: boolean; reason?: string }>;
  getStorageInfo: () => Promise<DesktopStorageInfo>;
  setAppDataLocation: (
    path: string | null,
  ) => Promise<{ ok: boolean; reason?: string; restartRequired?: boolean }>;
  setRootStorageLocation: (
    path: string | null,
  ) => Promise<{ ok: boolean; reason?: string }>;
  setWorkspaceDataLocation: (
    path: string | null,
  ) => Promise<{ ok: boolean; reason?: string; target?: string }>;
  listWorkspaceChatSummaries: (
    workspaceRoots: string[],
  ) => Promise<WorkspaceChatSummary[]>;
  deleteWorkspaceChat: (
    workspaceRoot: string,
    threadId: string,
  ) => Promise<{ ok: boolean; reason?: string }>;
}

declare global {
  interface Window {
    [MITII_DESKTOP_BRIDGE_KEY]?: MitiiDesktopBridge;
  }
}
