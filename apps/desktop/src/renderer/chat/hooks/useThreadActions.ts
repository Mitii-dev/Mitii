/** New / open / delete chat thread actions. */

import { emptyTokenUsage } from '@mitii/ui-react';
import { postHistory, deleteHistoryThread } from '../../api.js';
import {
  type PlanArtifact,
  type PlanStrategyDecision,
  type TaskList,
} from '../../../shared/planFormat.js';
import type { useRunAbort } from './useRunAbort.js';
import type { useChatThreadState } from './useChatThreadState.js';
import type { useChatPersistence } from './useChatPersistence.js';
import type { useEngineSnapshot } from '../../shell/hooks/useEngineSnapshot.js';
import type { useShellUiState } from '../../shell/hooks/useShellUiState.js';
import { type HistoryThread, type ChatMessage } from '../chatTypes.js';
import { tokenUsageFromThread } from '../threadHistory.js';

export function useThreadActions(deps: Pick<
    ReturnType<typeof useRunAbort>,
    'stopRun'
  > &
  Pick<
    ReturnType<typeof useChatThreadState>,
    'setSuspension' | 'threadId' | 'tokenUsageRef' | 'setMessages' | 'setThreadId'
    | 'setTokenUsage' | 'setHistory' | 'setPendingPlan' | 'setPendingPlanStrategy'
    | 'setPendingTaskList' | 'setCompletedPlanStepIds' | 'history'
  > &
  Pick<
    ReturnType<typeof useChatPersistence>,
    'persistTokenUsageOnly'
  > &
  Pick<
    ReturnType<typeof useEngineSnapshot>,
    'engine' | 'snapshot'
  > &
  Pick<
    ReturnType<typeof useShellUiState>,
    'setView'
  >) {
  const {
    stopRun,
    setSuspension,
    threadId,
    tokenUsageRef,
    setMessages,
    setThreadId,
    setTokenUsage,
    setHistory,
    setPendingPlan,
    setPendingPlanStrategy,
    setPendingTaskList,
    setCompletedPlanStepIds,
    history,
    persistTokenUsageOnly,
    engine,
    snapshot,
    setView,
  } = deps;

  const onNewChat = async () => {
    stopRun();
    setSuspension(null);
    if (threadId) {
      await persistTokenUsageOnly(threadId, tokenUsageRef.current);
    }
    if (!engine) {
      setMessages([]);
      setThreadId(undefined);
      setTokenUsage(emptyTokenUsage());
      setView('chat');
      return;
    }
    const store = await postHistory({
      ...engine,
      body: { action: 'new', title: 'New chat' },
    });
    setHistory(store.threads as HistoryThread[]);
    setThreadId(store.activeThreadId);
    setMessages([]);
    setPendingPlan(null);
    setPendingPlanStrategy(null);
    setPendingTaskList(null);
    setCompletedPlanStepIds(new Set());
    setTokenUsage(emptyTokenUsage());
    setView('chat');
  };

  const onOpenThread = async (id: string) => {
    if (!engine) return;
    setSuspension(null);
    if (threadId && threadId !== id) {
      await persistTokenUsageOnly(threadId, tokenUsageRef.current);
    }
    const store = await postHistory({
      ...engine,
      body: { action: 'activate', threadId: id },
    });
    const threads = store.threads as HistoryThread[];
    setHistory(threads);
    setThreadId(id);
    const active = threads.find((t) => t.id === id);
    setMessages((active?.messages ?? []) as ChatMessage[]);
    setPendingPlan(
      (active?.pendingPlan as PlanArtifact | undefined) ?? null,
    );
    setPendingPlanStrategy(
      (active?.pendingPlanStrategy as PlanStrategyDecision | undefined) ??
        null,
    );
    setPendingTaskList(
      (active?.pendingTaskList as TaskList | undefined) ?? null,
    );
    setTokenUsage(
      tokenUsageFromThread(
        active,
        typeof snapshot?.settings.provider.contextWindow === 'number'
          ? snapshot.settings.provider.contextWindow
          : 0,
      ),
    );
    setView('chat');
  };

  const onDeleteThread = async (id: string) => {
    if (!engine) return;
    const label =
      history.find((t) => t.id === id)?.title?.trim() || 'this chat';
    const ok = window.confirm(`Delete “${label}”? This cannot be undone.`);
    if (!ok) return;

    const store = await deleteHistoryThread({ ...engine, threadId: id });
    setHistory(store.threads as HistoryThread[]);
    const nextId = store.activeThreadId;
    if (threadId === id) {
      setThreadId(nextId);
      const next = store.threads.find((t) => t.id === nextId) as
        | HistoryThread
        | undefined;
      setMessages((next?.messages ?? []) as ChatMessage[]);
      setSuspension(null);
      setTokenUsage(tokenUsageFromThread(next));
    }
  };

  return {
    onNewChat,
    onOpenThread,
    onDeleteThread,
  };
}
