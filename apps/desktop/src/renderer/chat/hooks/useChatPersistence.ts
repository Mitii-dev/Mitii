/** Persist open chat, token usage and model/context-window effects. */

import { useEffect } from 'react';
import { postHistory } from '../../api.js';
import { type TokenUsageState } from '@mitii/ui-react';
import {
  type PlanArtifact,
  type PlanStrategyDecision,
  type TaskList,
} from '../../../shared/planFormat.js';
import type { useShellUiState } from '../../shell/hooks/useShellUiState.js';
import type { useEngineSnapshot } from '../../shell/hooks/useEngineSnapshot.js';
import type { useChatThreadState } from './useChatThreadState.js';
import type { useProviderState } from '../../settings/hooks/useProviderState.js';
import { type HistoryThread, type ChatMessage } from '../chatTypes.js';
import { serializeTokenUsage, compactMessagesForHistory } from '../threadHistory.js';

export function useChatPersistence(deps: Pick<
    ReturnType<typeof useShellUiState>,
    'view' | 'chatLayout'
  > &
  Pick<
    ReturnType<typeof useEngineSnapshot>,
    'engine' | 'snapshot'
  > &
  Pick<
    ReturnType<typeof useChatThreadState>,
    'threadId' | 'messages' | 'setHistory' | 'setTokenUsage' | 'tokenUsageRef'
    | 'tokenUsage' | 'setThreadId'
  > &
  Pick<
    ReturnType<typeof useProviderState>,
    'setKnownModels'
  >) {
  const {
    view,
    chatLayout,
    engine,
    snapshot,
    threadId,
    messages,
    setHistory,
    setTokenUsage,
    tokenUsageRef,
    tokenUsage,
    setThreadId,
    setKnownModels,
  } = deps;

  // Persist open chat when leaving the chat view so tab switches never lose it.
  useEffect(() => {
    if (view === 'chat') return;
    if (!engine || !threadId || messages.length === 0) return;
    void postHistory({
      ...engine,
      body: {
        action: 'save',
        threadId,
        messages: messages.map(({ streaming: _s, ...rest }) => rest),
        title: messages.find((m) => m.role === 'user')?.text.slice(0, 48),
      },
    })
      .then((store) => {
        setHistory((prev) =>
          store.threads.length > 0
            ? (store.threads as HistoryThread[])
            : prev,
        );
      })
      .catch(() => undefined);
  }, [view]);

  // Also persist when switching Chat ↔ Code so a refresh doesn't lose the turn.
  useEffect(() => {
    if (view !== 'chat') return;
    if (!engine || !threadId || messages.length === 0) return;
    const handle = window.setTimeout(() => {
      void postHistory({
        ...engine,
        body: {
          action: 'save',
          threadId,
          messages: messages.map(({ streaming: _s, ...rest }) => rest),
          title: messages.find((m) => m.role === 'user')?.text.slice(0, 48),
        },
      })
        .then((store) => {
          setHistory((prev) =>
            store.threads.length > 0
              ? (store.threads as HistoryThread[])
              : prev,
          );
        })
        .catch(() => undefined);
    }, 400);
    return () => window.clearTimeout(handle);
  }, [chatLayout]);

  useEffect(() => {
    const model = snapshot?.settings.provider.model?.trim();
    if (model) {
      setKnownModels((prev) =>
        prev.includes(model) ? prev : [model, ...prev],
      );
    }
    const window =
      typeof snapshot?.settings.provider.contextWindow === 'number'
        ? snapshot.settings.provider.contextWindow
        : 0;
    if (window > 0) {
      setTokenUsage((prev) =>
        prev.contextWindow > 0 ? prev : { ...prev, contextWindow: window },
      );
    }
  }, [snapshot?.settings.provider.model, snapshot?.settings.provider.contextWindow]);

  useEffect(() => {
    tokenUsageRef.current = tokenUsage;
  }, [tokenUsage]);

  const persistMessages = async (
    nextMessages: ChatMessage[],
    activeId?: string,
    usage?: TokenUsageState,
    planFields?: {
      pendingPlan?: PlanArtifact | null;
      pendingPlanStrategy?: PlanStrategyDecision | null;
      pendingTaskList?: TaskList | null;
      completedPlanStepIds?: string[] | null;
      pendingNextActionPrompt?: string | null;
      clearPendingPlan?: boolean;
    },
  ) => {
    if (!engine) return;
    const tokenSnapshot = serializeTokenUsage(
      usage ?? tokenUsageRef.current,
    );
    const store = await postHistory({
      ...engine,
      body: {
        action: 'save',
        threadId: activeId ?? threadId,
        messages: compactMessagesForHistory(nextMessages),
        title: nextMessages.find((m) => m.role === 'user')?.text.slice(0, 48),
        tokenUsage: tokenSnapshot,
        ...(planFields?.clearPendingPlan
          ? { clearPendingPlan: true }
          : {
              ...(planFields && 'pendingPlan' in planFields
                ? { pendingPlan: planFields.pendingPlan }
                : {}),
              ...(planFields && 'pendingPlanStrategy' in planFields
                ? { pendingPlanStrategy: planFields.pendingPlanStrategy }
                : {}),
              ...(planFields && 'pendingTaskList' in planFields
                ? { pendingTaskList: planFields.pendingTaskList }
                : {}),
              ...(planFields && 'completedPlanStepIds' in planFields
                ? { completedPlanStepIds: planFields.completedPlanStepIds }
                : {}),
              ...(planFields && 'pendingNextActionPrompt' in planFields
                ? {
                    pendingNextActionPrompt: planFields.pendingNextActionPrompt,
                  }
                : {}),
            }),
      },
    });
    setHistory(store.threads as HistoryThread[]);
    if (store.activeThreadId) setThreadId(store.activeThreadId);
  };

  const persistTokenUsageOnly = async (
    activeId: string | undefined,
    usage: TokenUsageState,
  ) => {
    if (!engine || !activeId) return;
    try {
      const store = await postHistory({
        ...engine,
        body: {
          action: 'save',
          threadId: activeId,
          tokenUsage: serializeTokenUsage(usage),
        },
      });
      setHistory(store.threads as HistoryThread[]);
    } catch {
      /* best-effort */
    }
  };

  return {
    persistTokenUsageOnly,
    persistMessages,
  };
}
