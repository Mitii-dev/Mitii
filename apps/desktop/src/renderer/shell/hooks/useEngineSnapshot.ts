/** Desktop shell snapshot, engine connection and workspace-loading state. */

import { useState } from 'react';
import { type DesktopShellSnapshot } from '../../../shared/bridge.js';
import { mergeDesktopSettings, DEFAULT_DESKTOP_SETTINGS } from '../../../shared/settings.js';

export function useEngineSnapshot() {
  const [snapshot, setSnapshot] = useState<DesktopShellSnapshot | null>(null);

  /** Full-screen loader while switching / opening a workspace. */
  const [workspaceLoading, setWorkspaceLoading] = useState(false);

  const [workspaceLoadingLabel, setWorkspaceLoadingLabel] = useState(
    'Loading workspace…',
  );

  const [settingsBusy, setSettingsBusy] = useState(false);

  const [error, setError] = useState<string | null>(null);

  const engine = snapshot
    ? { baseUrl: snapshot.engineBaseUrl, token: snapshot.authToken }
    : null;

  const needsModel = !snapshot?.settings.provider.model?.trim();

  const settings =
    snapshot?.settings ?? mergeDesktopSettings(DEFAULT_DESKTOP_SETTINGS);

  const modelLabel =
    settings.provider.model.trim() || settings.provider.preset || 'Model';

  return {
    settings,
    engine,
    setError,
    setSnapshot,
    snapshot,
    setWorkspaceLoading,
    setWorkspaceLoadingLabel,
    setSettingsBusy,
    needsModel,
    modelLabel,
    error,
    workspaceLoading,
    workspaceLoadingLabel,
    settingsBusy,
  };
}
