/** App-level view, layout, picker and panel UI state. */

import { useState, useRef } from 'react';
import { type DesktopTheme, resolveTheme } from '../theme.js';
import { usePersistedWidth } from '../ResizeHandle.js';
import { type SettingsTabId } from '../../../shared/settings.js';
import { type FeatureTabId } from '../../settings/SettingsPanel.js';
import { type View, type ChatLayout, type WorkspaceSide } from '../shellTypes.js';

export function useShellUiState() {
  const [view, setView] = useState<View>('chat');

  const [chatLayout, setChatLayout] = useState<ChatLayout>(() => {
    try {
      const v = localStorage.getItem('mitii.desktop.chatLayout');
      return v === 'code' ? 'code' : 'chat';
    } catch {
      return 'chat';
    }
  });

  const [theme, setTheme] = useState<DesktopTheme>(() => resolveTheme());

  const [historyMenuOpen, setHistoryMenuOpen] = useState(false);

  const historyMenuRef = useRef<HTMLDivElement>(null);

  const [sideWidth, setSideWidth] = usePersistedWidth('mitii.desktop.sideWidth', {
    initial: 268,
    min: 220,
    max: 420,
  });

  const [codeChatWidth, setCodeChatWidth] = usePersistedWidth(
    'mitii.desktop.codeChatWidth',
    { initial: 420, min: 280, max: 720 },
  );

  const [openPathRequest, setOpenPathRequest] = useState<{
    path: string;
    view?: 'file' | 'diff';
  } | null>(null);

  /** Push agent write paths into WorkspacePanel immediately (explorer + SCM). */
  const [workspaceInvalidate, setWorkspaceInvalidate] = useState<{
    seq: number;
    paths: string[];
  } | null>(null);

  const workspaceInvalidateSeq = useRef(0);

  const [workspaceSide, setWorkspaceSide] = useState<WorkspaceSide>('explorer');

  const [settingsTab, setSettingsTab] = useState<SettingsTabId>('profiles');

  const [featureTab, setFeatureTab] = useState<FeatureTabId>('autocomplete');

  const [picker, setPicker] = useState<'workspace' | 'profile' | null>(null);

  const [gitBadge, setGitBadge] = useState(0);

  return {
    setView,
    workspaceSide,
    view,
    chatLayout,
    workspaceInvalidateSeq,
    setWorkspaceInvalidate,
    setPicker,
    setChatLayout,
    theme,
    setTheme,
    historyMenuOpen,
    historyMenuRef,
    setHistoryMenuOpen,
    setWorkspaceSide,
    setOpenPathRequest,
    setSettingsTab,
    setFeatureTab,
    picker,
    sideWidth,
    setSideWidth,
    settingsTab,
    gitBadge,
    setGitBadge,
    openPathRequest,
    workspaceInvalidate,
    codeChatWidth,
    setCodeChatWidth,
    featureTab,
  };
}
