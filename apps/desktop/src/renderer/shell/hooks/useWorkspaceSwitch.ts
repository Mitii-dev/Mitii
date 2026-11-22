/** Pick, switch and forget workspaces. */

import { getDesktopBridge, workspaceLabel } from '../../api.js';
import type { useChatThreadState } from '../../chat/hooks/useChatThreadState.js';
import type { useEngineSnapshot } from './useEngineSnapshot.js';
import type { useShellUiState } from './useShellUiState.js';
import type { useRunAbort } from '../../chat/hooks/useRunAbort.js';
import type { useEngineLifecycle } from './useEngineLifecycle.js';

export function useWorkspaceSwitch(deps: Pick<
    ReturnType<typeof useChatThreadState>,
    'setBusy' | 'setHistoryLoading'
  > &
  Pick<
    ReturnType<typeof useEngineSnapshot>,
    'setWorkspaceLoading' | 'setWorkspaceLoadingLabel' | 'setError' | 'snapshot'
  > &
  Pick<
    ReturnType<typeof useShellUiState>,
    'setPicker'
  > &
  Pick<
    ReturnType<typeof useRunAbort>,
    'resetChatForWorkspaceSwitch'
  > &
  Pick<
    ReturnType<typeof useEngineLifecycle>,
    'refresh'
  >) {
  const {
    setBusy,
    setHistoryLoading,
    setWorkspaceLoading,
    setWorkspaceLoadingLabel,
    setError,
    snapshot,
    setPicker,
    resetChatForWorkspaceSwitch,
    refresh,
  } = deps;

  const onPickWorkspace = async () => {
    const bridge = getDesktopBridge();
    if (!bridge) return;
    setBusy(true);
    setWorkspaceLoading(true);
    setWorkspaceLoadingLabel('Opening workspace…');
    setPicker(null);
    try {
      await bridge.pickWorkspace();
      resetChatForWorkspaceSwitch();
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setHistoryLoading(false);
    } finally {
      setBusy(false);
      setWorkspaceLoading(false);
    }
  };

  const onSwitchWorkspace = async (workspaceRoot: string) => {
    const bridge = getDesktopBridge();
    if (!bridge) return;
    if (workspaceRoot === snapshot?.workspaceRoot) {
      setPicker(null);
      return;
    }
    setBusy(true);
    setWorkspaceLoading(true);
    setWorkspaceLoadingLabel(
      `Loading ${workspaceLabel(workspaceRoot) || 'workspace'}…`,
    );
    setPicker(null);
    try {
      resetChatForWorkspaceSwitch();
      const result = await bridge.setWorkspace(workspaceRoot);
      if (!result.ok) {
        setError(result.reason ?? 'Failed to switch repository');
        setHistoryLoading(false);
        return;
      }
      // Expand the destination project in the sidebar.
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setHistoryLoading(false);
    } finally {
      setBusy(false);
      setWorkspaceLoading(false);
    }
  };

  const onForgetWorkspace = async (workspaceRoot: string) => {
    const bridge = getDesktopBridge();
    if (!bridge?.forgetWorkspace) return;
    const label = workspaceLabel(workspaceRoot);
    const ok = window.confirm(
      `Remove “${label}” from Mitii?\n\nProject files and .mitii data stay on disk. Re-add the folder later to restore chats and settings.`,
    );
    if (!ok) return;
    setBusy(true);
    setPicker(null);
    try {
      const result = await bridge.forgetWorkspace(workspaceRoot);
      if (!result.ok) {
        setError(result.reason ?? 'Failed to remove workspace');
        return;
      }
      resetChatForWorkspaceSwitch();
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return {
    onPickWorkspace,
    onSwitchWorkspace,
    onForgetWorkspace,
  };
}
