/** Execute or dismiss the pending plan. */

import { useCallback } from 'react';
import { postHistory } from '../../api.js';
import type { useChatThreadState } from './useChatThreadState.js';
import type { useComposerState } from './useComposerState.js';
import type { useRunSubmit } from './useRunSubmit.js';
import type { useEngineSnapshot } from '../../shell/hooks/useEngineSnapshot.js';
import { type HistoryThread } from '../chatTypes.js';

export function usePlanActions(deps: Pick<
    ReturnType<typeof useChatThreadState>,
    'pendingPlan' | 'busy' | 'pendingPlanStrategy' | 'pendingTaskList'
    | 'pendingNextActionPrompt' | 'setPendingPlan' | 'setPendingPlanStrategy'
    | 'setPendingTaskList' | 'setCompletedPlanStepIds'
    | 'setPendingNextActionPrompt' | 'threadId' | 'setHistory'
  > &
  Pick<
    ReturnType<typeof useComposerState>,
    'setMode'
  > &
  Pick<
    ReturnType<typeof useRunSubmit>,
    'onSubmit'
  > &
  Pick<
    ReturnType<typeof useEngineSnapshot>,
    'engine'
  >) {
  const {
    pendingPlan,
    busy,
    pendingPlanStrategy,
    pendingTaskList,
    pendingNextActionPrompt,
    setPendingPlan,
    setPendingPlanStrategy,
    setPendingTaskList,
    setCompletedPlanStepIds,
    setPendingNextActionPrompt,
    threadId,
    setHistory,
    setMode,
    onSubmit,
    engine,
  } = deps;

  const executePendingPlan = useCallback(() => {
    if (!pendingPlan || busy) return;
    setMode('agent');
    void onSubmit({
      prompt: `Implement the approved plan.\n\nObjective: ${pendingPlan.objective}`,
      mode: 'agent',
      approvedPlan: pendingPlan,
      approvedPlanStrategy: pendingPlanStrategy,
      taskList: pendingTaskList,
      clearPendingPlanAfter: true,
    });
  }, [
    busy,
    onSubmit,
    pendingPlan,
    pendingPlanStrategy,
    pendingTaskList,
  ]);

  const continueNextSlice = useCallback(() => {
    if (busy) return;
    const nextTitle = pendingTaskList?.items.find(
      (item) => item.status === 'pending' || item.status === 'active',
    )?.title;
    const prompt =
      pendingNextActionPrompt?.trim() ||
      (nextTitle
        ? `Continue with the next plan item: ${nextTitle}`
        : 'Continue with the next plan item.');
    setMode('agent');
    void onSubmit({
      prompt,
      mode: 'agent',
      ...(pendingPlan ? { approvedPlan: pendingPlan } : {}),
      ...(pendingPlanStrategy
        ? { approvedPlanStrategy: pendingPlanStrategy }
        : {}),
      ...(pendingTaskList ? { taskList: pendingTaskList } : {}),
    });
  }, [
    busy,
    onSubmit,
    pendingNextActionPrompt,
    pendingPlan,
    pendingPlanStrategy,
    pendingTaskList,
    setMode,
  ]);

  const dismissPendingPlan = useCallback(() => {
    setPendingPlan(null);
    setPendingPlanStrategy(null);
    setPendingTaskList(null);
    setCompletedPlanStepIds(new Set());
    setPendingNextActionPrompt(null);
    if (!engine || !threadId) return;
    void postHistory({
      ...engine,
      body: {
        action: 'save',
        threadId,
        clearPendingPlan: true,
      },
    }).then((store) => {
      setHistory(store.threads as HistoryThread[]);
    });
  }, [engine, threadId]);

  return {
    executePendingPlan,
    continueNextSlice,
    dismissPendingPlan,
  };
}
