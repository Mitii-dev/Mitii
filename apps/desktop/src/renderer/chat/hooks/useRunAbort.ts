/** Run abort helpers and chat reset on workspace switch. */

import { isTransientEngineNetworkError } from '../../shell/engineNetwork.js';
import { emptyTokenUsage } from '@mitii/ui-react';
import type { useChatThreadState } from './useChatThreadState.js';
import type { useComposerState } from './useComposerState.js';
import type { useIndexState } from '../../indexing/hooks/useIndexState.js';

export function useRunAbort(deps: Pick<
    ReturnType<typeof useChatThreadState>,
    'runAbortRef' | 'setSuspension' | 'setMessages' | 'setThreadId' | 'setHistory'
    | 'setHistoryLoading' | 'setTokenUsage' | 'setPendingPlan' | 'setPendingPlanStrategy'
    | 'setPendingTaskList' | 'setCompletedPlanStepIds'
  > &
  Pick<
    ReturnType<typeof useComposerState>,
    'setPendingAutoContinue' | 'pilotAutoContinueStreakRef' | 'setPinnedPaths'
    | 'setPinnedSkillIds' | 'setPinnedMcpIds'
  > &
  Pick<
    ReturnType<typeof useIndexState>,
    'setIndexStatus' | 'setIndexIndexing' | 'setIndexProgress' | 'setIndexStream'
  >) {
  const {
    runAbortRef,
    setSuspension,
    setMessages,
    setThreadId,
    setHistory,
    setHistoryLoading,
    setTokenUsage,
    setPendingPlan,
    setPendingPlanStrategy,
    setPendingTaskList,
    setCompletedPlanStepIds,
    setPendingAutoContinue,
    pilotAutoContinueStreakRef,
    setPinnedPaths,
    setPinnedSkillIds,
    setPinnedMcpIds,
    setIndexStatus,
    setIndexIndexing,
    setIndexProgress,
    setIndexStream,
  } = deps;

  const isAbortError = (err: unknown): boolean => {
    if (!err) return false;
    if (err instanceof DOMException && err.name === 'AbortError') return true;
    if (err instanceof Error) {
      return (
        err.name === 'AbortError' ||
        /abort(ed)?|user_cancelled|cancell?ed/i.test(err.message)
      );
    }
    return false;
  };

  /** Stop / cancel often surfaces as Failed to fetch instead of AbortError. */
  const shouldIgnoreRunError = (
    err: unknown,
    signal?: AbortSignal,
  ): boolean => {
    if (isAbortError(err)) return true;
    if (signal?.aborted || runAbortRef.current?.signal.aborted) return true;
    return false;
  };

  const runErrorMessage = (err: unknown): string => {
    if (isTransientEngineNetworkError(err)) {
      return 'Engine was restarting or busy — retry the message.';
    }
    return err instanceof Error ? err.message : String(err);
  };

  const beginRunAbort = (): AbortSignal => {
    runAbortRef.current?.abort();
    const controller = new AbortController();
    runAbortRef.current = controller;
    return controller.signal;
  };

  const clearRunAbort = (signal?: AbortSignal) => {
    if (!runAbortRef.current) return;
    if (signal && runAbortRef.current.signal !== signal) return;
    runAbortRef.current = null;
  };

  const stopRun = () => {
    // Cancel must not race Pilot auto-Continue into resume with no checkpoint.
    setPendingAutoContinue(null);
    pilotAutoContinueStreakRef.current = 0;
    setSuspension(null);
    runAbortRef.current?.abort();
  };

  const resetChatForWorkspaceSwitch = () => {
    stopRun();
    setMessages([]);
    setThreadId(undefined);
    setHistory([]);
    setHistoryLoading(true);
    setTokenUsage(emptyTokenUsage());
    setSuspension(null);
    setPendingPlan(null);
    setPendingPlanStrategy(null);
    setPendingTaskList(null);
    setCompletedPlanStepIds(new Set());
    setPinnedPaths([]);
    setPinnedSkillIds([]);
    setPinnedMcpIds([]);
    setIndexStatus(null);
    setIndexIndexing(false);
    setIndexProgress(null);
    setIndexStream([]);
  };

  return {
    resetChatForWorkspaceSwitch,
    stopRun,
    beginRunAbort,
    shouldIgnoreRunError,
    runErrorMessage,
    clearRunAbort,
  };
}
