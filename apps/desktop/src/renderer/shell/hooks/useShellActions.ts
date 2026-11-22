/** Layout and theme actions. */

import { type DesktopTheme, persistTheme } from '../theme.js';
import { useEffect } from 'react';
import type { useShellUiState } from './useShellUiState.js';
import { type ChatLayout } from '../shellTypes.js';

export function useShellActions(deps: Pick<
    ReturnType<typeof useShellUiState>,
    'setChatLayout' | 'setView' | 'theme' | 'setTheme' | 'historyMenuOpen'
    | 'historyMenuRef' | 'setHistoryMenuOpen'
  >) {
  const {
    setChatLayout,
    setView,
    theme,
    setTheme,
    historyMenuOpen,
    historyMenuRef,
    setHistoryMenuOpen,
  } = deps;

  const setLayout = (next: ChatLayout) => {
    setChatLayout(next);
    setView('chat');
    try {
      localStorage.setItem('mitii.desktop.chatLayout', next);
    } catch {
      /* ignore */
    }
  };

  const toggleTheme = () => {
    const next: DesktopTheme = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    persistTheme(next);
  };

  useEffect(() => {
    if (!historyMenuOpen) return;
    const onDoc = (event: MouseEvent) => {
      if (!historyMenuRef.current?.contains(event.target as Node)) {
        setHistoryMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [historyMenuOpen]);

  return {
    setLayout,
    toggleTheme,
  };
}
