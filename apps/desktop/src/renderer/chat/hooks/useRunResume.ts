/** Resume a suspended run after an approval or clarification. */

import { useCallback } from 'react';
import { type DesktopShellSnapshot } from '../../../shared/bridge.js';
import { streamResume } from '../../api.js';
import { isTransientEngineNetworkError } from '../../shell/engineNetwork.js';
import {
  type PlanArtifact,
  type PlanStrategyDecision,
  type TaskList,
} from '../../../shared/planFormat.js';
import type { useEngineSnapshot } from '../../shell/hooks/useEngineSnapshot.js';
import type { useChatThreadState } from './useChatThreadState.js';
import type { useRunAbort } from './useRunAbort.js';
import type { useComposerState } from './useComposerState.js';
import type { useFeedScroll } from './useFeedScroll.js';
import type { useEngineLifecycle } from '../../shell/hooks/useEngineLifecycle.js';
import type { useRunStream } from './useRunStream.js';
import type { useShellUiState } from '../../shell/hooks/useShellUiState.js';
import type { useChatPersistence } from './useChatPersistence.js';
import { stripContinueCtaFromAnswer } from '../../../shared/fileChanges.js';

export function useRunResume(deps: Pick<
    ReturnType<typeof useEngineSnapshot>,
    'snapshot' | 'setError'
  > &
  Pick<
    ReturnType<typeof useChatThreadState>,
    'busy' | 'setBusy' | 'runActiveRef' | 'setSuspension' | 'messages' | 'setMessages'
    | 'threadId' | 'setPendingPlan' | 'setPendingPlanStrategy' | 'setPendingTaskList'
    | 'setCompletedPlanStepIds' | 'setPendingNextActionPrompt' | 'setTokenUsage'
  > &
  Pick<
    ReturnType<typeof useRunAbort>,
    'beginRunAbort' | 'shouldIgnoreRunError' | 'runErrorMessage' | 'clearRunAbort'
  > &
  Pick<
    ReturnType<typeof useComposerState>,
    'mode' | 'approvalMode' | 'dbAccess'
  > &
  Pick<
    ReturnType<typeof useFeedScroll>,
    'scrollToBottom'
  > &
  Pick<
    ReturnType<typeof useEngineLifecycle>,
    'ensureEngineReadyForPrompt'
  > &
  Pick<
    ReturnType<typeof useRunStream>,
    'consumeStream' | 'resolveFileChanges' | 'snapshotDirtyPaths'
  > &
  Pick<
    ReturnType<typeof useShellUiState>,
    'workspaceInvalidateSeq' | 'setWorkspaceInvalidate'
  > &
  Pick<
    ReturnType<typeof useChatPersistence>,
    'persistMessages'
  >) {
  const {
    snapshot,
    setError,
    busy,
    setBusy,
    runActiveRef,
    setSuspension,
    messages,
    setMessages,
    threadId,
    setPendingPlan,
    setPendingPlanStrategy,
    setPendingTaskList,
    setCompletedPlanStepIds,
    setPendingNextActionPrompt,
    setTokenUsage,
    beginRunAbort,
    shouldIgnoreRunError,
    runErrorMessage,
    clearRunAbort,
    mode,
    approvalMode,
    dbAccess,
    scrollToBottom,
    ensureEngineReadyForPrompt,
    consumeStream,
    resolveFileChanges,
    snapshotDirtyPaths,
    workspaceInvalidateSeq,
    setWorkspaceInvalidate,
    persistMessages,
  } = deps;

  const runResume = useCallback(
    async (body: Record<string, unknown>) => {
      if (!snapshot || busy) return;
      setBusy(true);
      runActiveRef.current = true;
      const signal = beginRunAbort();
      setError(null);
      setSuspension(null);
      const runStartedAtMs = Date.now();
      const beforeDirtyPaths = await snapshotDirtyPaths();

      const existing = [...messages]
        .reverse()
        .find((m) => m.role === 'assistant');
      const assistantId = existing?.id ?? `a_${Date.now()}`;
      const priorText = existing?.text ?? '';
      const priorActivity = existing?.activity ?? [];

      if (!existing) {
        setMessages((prev) => [
          ...prev,
          {
            id: assistantId,
            role: 'assistant',
            text: '',
            mode,
            activity: [],
            streaming: true,
          },
        ]);
      } else {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId ? { ...m, streaming: true } : m,
          ),
        );
      }

      requestAnimationFrame(() => scrollToBottom(true));

      try {
        const ready = await ensureEngineReadyForPrompt();
        const runResumeStream = (snap: DesktopShellSnapshot) =>
          consumeStream(
            streamResume({
              baseUrl: snap.engineBaseUrl,
              mode,
              signal,
              ...(snap.authToken ? { token: snap.authToken } : {}),
              body: {
                ...body,
                approvalPreset: approvalMode,
                ...(mode === 'database' ? { dbAccess } : {}),
                ...(threadId ? { sessionId: threadId } : {}),
              },
            }),
            assistantId,
          );

        let streamResult: Awaited<ReturnType<typeof runResumeStream>>;
        try {
          streamResult = await runResumeStream(ready.snapshot);
        } catch (err) {
          if (
            shouldIgnoreRunError(err, signal) ||
            !isTransientEngineNetworkError(err)
          ) {
            throw err;
          }
          const retried = await ensureEngineReadyForPrompt();
          streamResult = await runResumeStream(retried.snapshot);
        }

        const {
          assistant,
          activity,
          suspension: nextSuspension,
          mutatedPaths,
          processMutation,
          tokenUsage: nextUsage,
          plan: resultPlan,
          planStrategy: resultPlanStrategy,
          taskList: resultTaskList,
          completedPlanStepIds: resultCompletedIds,
          nextActionPrompt: resultNextActionPrompt,
          pendingCount: resultPendingCount,
        } = streamResult;

        const mergedActivity = [...priorActivity, ...activity];
        const resolvedChanges = await resolveFileChanges(mutatedPaths, {
          beforePaths: beforeDirtyPaths,
          sinceMs: runStartedAtMs,
          includeDirtyDelta:
            processMutation ||
            mutatedPaths.length > 0 ||
            beforeDirtyPaths.length > 0,
        });
        const fileChanges = resolvedChanges
          ? { ...resolvedChanges, runId: assistantId }
          : mutatedPaths.length > 0
            ? {
                runId: assistantId,
                files: mutatedPaths.map((path) => ({
                  path,
                  status: 'M' as const,
                  additions: 0,
                  deletions: 0,
                })),
                totalCount: mutatedPaths.length,
                totalAdditions: 0,
                totalDeletions: 0,
              }
            : undefined;
        if (
          mutatedPaths.length > 0 ||
          (fileChanges?.totalCount ?? fileChanges?.files.length ?? 0) > 0
        ) {
          workspaceInvalidateSeq.current += 1;
          setWorkspaceInvalidate({
            seq: workspaceInvalidateSeq.current,
            paths:
              mutatedPaths.length > 0
                ? mutatedPaths
                : (fileChanges?.files.map((file) => file.path) ?? []),
          });
        }
        const hasOpenSliceWork =
          Boolean(resultNextActionPrompt) ||
          (typeof resultPendingCount === 'number' && resultPendingCount > 0) ||
          Boolean(
            resultTaskList?.items.some(
              (item) => item.status === 'pending' || item.status === 'active',
            ),
          );
        const strippedAssistant = hasOpenSliceWork
          ? stripContinueCtaFromAnswer(assistant)
          : assistant;
        let finalAssistant = strippedAssistant.trim()
          ? priorText
            ? `${priorText}\n\n${strippedAssistant}`
            : strippedAssistant
          : priorText;
        if (!finalAssistant.trim() && !nextSuspension) {
          finalAssistant =
            'No reply from the model. Check Settings → Provider.';
        }

        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId
              ? {
                  ...m,
                  text: finalAssistant,
                  activity: mergedActivity,
                  ...(fileChanges ? { fileChanges } : {}),
                  streaming: false,
                }
              : m,
          ),
        );

        let planPersist:
          | {
              pendingPlan?: PlanArtifact | null;
              pendingPlanStrategy?: PlanStrategyDecision | null;
              pendingTaskList?: TaskList | null;
              completedPlanStepIds?: string[] | null;
              pendingNextActionPrompt?: string | null;
            }
          | undefined;
        if (resultCompletedIds?.length) {
          setCompletedPlanStepIds(new Set(resultCompletedIds));
        }
        if (resultNextActionPrompt) {
          setPendingNextActionPrompt(resultNextActionPrompt);
        } else if (!hasOpenSliceWork) {
          setPendingNextActionPrompt(null);
        }
        if (resultPlan) {
          setPendingPlan(resultPlan);
          setPendingPlanStrategy(resultPlanStrategy ?? null);
          setPendingTaskList(resultTaskList ?? null);
          planPersist = {
            pendingPlan: resultPlan,
            pendingPlanStrategy: resultPlanStrategy ?? null,
            pendingTaskList: resultTaskList ?? null,
            ...(resultCompletedIds?.length
              ? { completedPlanStepIds: resultCompletedIds }
              : {}),
            ...(resultNextActionPrompt
              ? { pendingNextActionPrompt: resultNextActionPrompt }
              : hasOpenSliceWork
                ? {}
                : { pendingNextActionPrompt: null }),
          };
        } else if (hasOpenSliceWork) {
          if (resultTaskList) setPendingTaskList(resultTaskList);
          planPersist = {
            ...(resultTaskList ? { pendingTaskList: resultTaskList } : {}),
            ...(resultCompletedIds?.length
              ? { completedPlanStepIds: resultCompletedIds }
              : {}),
            ...(resultNextActionPrompt
              ? { pendingNextActionPrompt: resultNextActionPrompt }
              : {}),
          };
        }

        const withAssistant = existing
          ? messages.map((m) =>
              m.id === assistantId
                ? {
                    ...m,
                    text: finalAssistant,
                    activity: mergedActivity,
                    ...(fileChanges ? { fileChanges } : {}),
                    streaming: false,
                  }
                : m,
            )
          : [
              ...messages,
              {
                id: assistantId,
                role: 'assistant' as const,
                text: finalAssistant,
                mode,
                activity: mergedActivity,
                ...(fileChanges ? { fileChanges } : {}),
                streaming: false,
              },
            ];
        await persistMessages(
          withAssistant,
          threadId,
          nextUsage,
          planPersist,
        );
      } catch (err) {
        if (!shouldIgnoreRunError(err, signal)) {
          setError(runErrorMessage(err));
        }
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId ? { ...m, streaming: false } : m,
          ),
        );
        setTokenUsage((prev) => ({ ...prev, live: false }));
      } finally {
        clearRunAbort(signal);
        runActiveRef.current = false;
        setBusy(false);
      }
    },
    [
      approvalMode,
      busy,
      consumeStream,
      dbAccess,
      ensureEngineReadyForPrompt,
      messages,
      mode,
      resolveFileChanges,
      snapshotDirtyPaths,
      scrollToBottom,
      snapshot,
      threadId,
    ],
  );

  return {
    runResume,
  };
}
