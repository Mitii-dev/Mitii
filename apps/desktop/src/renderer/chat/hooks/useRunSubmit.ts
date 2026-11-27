/** Submit a prompt and stream the agent run. */

import { useCallback } from 'react';
import { type DesktopAgentMode } from '../../../shared/protocol.js';
import {
  type PlanArtifact,
  type PlanStrategyDecision,
  type TaskList,
  resolvePlanHandoff,
  resolvePlanStrategyHandoff,
  synthesizePlanArtifactFromAnswer,
} from '../../../shared/planFormat.js';
import { postHistory, streamPrompt } from '../../api.js';
import { deriveLiveTokenBudgetPreview } from '@mitii/ui-core';
import { resolveEffectiveContextWindow } from '../../../shared/contextWindow.js';
import {
  buildConversationCarry,
  collectStructuredCarryFromThread,
} from '../../../shared/conversationCarry.js';
import { type DesktopShellSnapshot } from '../../../shared/bridge.js';
import { isTransientEngineNetworkError } from '../../shell/engineNetwork.js';
import type { useComposerState } from './useComposerState.js';
import type { useEngineSnapshot } from '../../shell/hooks/useEngineSnapshot.js';
import type { useChatThreadState } from './useChatThreadState.js';
import type { useShellUiState } from '../../shell/hooks/useShellUiState.js';
import type { useRunAbort } from './useRunAbort.js';
import type { useFeedScroll } from './useFeedScroll.js';
import type { useEngineLifecycle } from '../../shell/hooks/useEngineLifecycle.js';
import type { useRunStream } from './useRunStream.js';
import type { useChatPersistence } from './useChatPersistence.js';
import { stripContinueCtaFromAnswer } from '../../../shared/fileChanges.js';
import { type ChatMessage, type HistoryThread } from '../chatTypes.js';

export function useRunSubmit(deps: Pick<
    ReturnType<typeof useComposerState>,
    'input' | 'mode' | 'setPendingAutoContinue' | 'pilotAutoContinueStreakRef'
    | 'setInput' | 'pinnedPaths' | 'dbAccess' | 'approvalMode' | 'thoroughness'
    | 'pinnedSkillIds' | 'pinnedMcpIds'
  > &
  Pick<
    ReturnType<typeof useEngineSnapshot>,
    'snapshot' | 'needsModel' | 'setError' | 'settings' | 'engine'
  > &
  Pick<
    ReturnType<typeof useChatThreadState>,
    'busy' | 'setBusy' | 'runActiveRef' | 'setSuspension' | 'setReviewDismissed'
    | 'editorContext' | 'messages' | 'setMessages' | 'threadId' | 'setThreadId'
    | 'setHistory' | 'pendingPlan' | 'pendingPlanStrategy' | 'pendingTaskList'
    | 'setPendingPlan' | 'setPendingPlanStrategy' | 'setPendingTaskList'
    | 'completedPlanStepIds' | 'setCompletedPlanStepIds'
    | 'setPendingNextActionPrompt' | 'setTokenUsage'
  > &
  Pick<
    ReturnType<typeof useShellUiState>,
    'setView' | 'workspaceInvalidateSeq' | 'setWorkspaceInvalidate'
  > &
  Pick<
    ReturnType<typeof useRunAbort>,
    'beginRunAbort' | 'shouldIgnoreRunError' | 'runErrorMessage' | 'clearRunAbort'
  > &
  Pick<
    ReturnType<typeof useFeedScroll>,
    'scrollToBottom'
  > &
  Pick<
    ReturnType<typeof useEngineLifecycle>,
    'ensureEngineReadyForPrompt' | 'ensureDatabaseAccessReady'
  > &
  Pick<
    ReturnType<typeof useRunStream>,
    'consumeStream' | 'resolveFileChanges' | 'snapshotDirtyPaths'
  > &
  Pick<
    ReturnType<typeof useChatPersistence>,
    'persistMessages'
  >) {
  const {
    input,
    mode,
    setPendingAutoContinue,
    pilotAutoContinueStreakRef,
    setInput,
    pinnedPaths,
    dbAccess,
    approvalMode,
    thoroughness,
    pinnedSkillIds,
    pinnedMcpIds,
    snapshot,
    needsModel,
    setError,
    settings,
    engine,
    busy,
    setBusy,
    runActiveRef,
    setSuspension,
    setReviewDismissed,
    editorContext,
    messages,
    setMessages,
    threadId,
    setThreadId,
    setHistory,
    pendingPlan,
    pendingPlanStrategy,
    pendingTaskList,
    setPendingPlan,
    setPendingPlanStrategy,
    setPendingTaskList,
    completedPlanStepIds,
    setCompletedPlanStepIds,
    setPendingNextActionPrompt,
    setTokenUsage,
    setView,
    workspaceInvalidateSeq,
    setWorkspaceInvalidate,
    beginRunAbort,
    shouldIgnoreRunError,
    runErrorMessage,
    clearRunAbort,
    scrollToBottom,
    ensureEngineReadyForPrompt,
    ensureDatabaseAccessReady,
    consumeStream,
    resolveFileChanges,
    snapshotDirtyPaths,
    persistMessages,
  } = deps;

  const onSubmit = useCallback(async (override?: {
    prompt?: string;
    mode?: DesktopAgentMode;
    approvedPlan?: PlanArtifact;
    approvedPlanStrategy?: PlanStrategyDecision | null;
    taskList?: TaskList | null;
    clearPendingPlanAfter?: boolean;
  }) => {
    const prompt = (override?.prompt ?? input).trim();
    const runMode = override?.mode ?? mode;
    if (!prompt || !snapshot || busy) return;
    if (needsModel) {
      setError('Select a model in Settings, then Save.');
      setView('settings');
      return;
    }
    setBusy(true);
    runActiveRef.current = true;
    const signal = beginRunAbort();
    setError(null);
    setSuspension(null);
    setPendingAutoContinue(null);
    pilotAutoContinueStreakRef.current = 0;
    setReviewDismissed(false);
    if (!override?.prompt) setInput('');
    const runStartedAtMs = Date.now();
    const beforeDirtyPaths = await snapshotDirtyPaths();

    const autoPins: string[] = [];
    const toggles = settings.ui.contextToggles;
    if (toggles.editor && editorContext.activePath) {
      autoPins.push(editorContext.activePath);
    }
    if (toggles.openTabs) {
      for (const path of editorContext.openPaths) {
        if (!autoPins.includes(path)) autoPins.push(path);
      }
    } else if (
      toggles.editor &&
      editorContext.openPaths.length === 1 &&
      editorContext.openPaths[0] &&
      !autoPins.includes(editorContext.openPaths[0])
    ) {
      autoPins.push(editorContext.openPaths[0]);
    }
    const submitPinnedPaths = [
      ...pinnedPaths,
      ...autoPins.filter((p) => !pinnedPaths.includes(p)),
    ].slice(0, 32);

    const userId = `u_${Date.now()}`;
    const assistantId = `a_${Date.now()}`;
    const nextMessages: ChatMessage[] = [
      ...messages,
      { id: userId, role: 'user', text: prompt, mode: runMode },
      {
        id: assistantId,
        role: 'assistant',
        text: '',
        mode: runMode,
        activity: [],
        streaming: true,
      },
    ];
    setMessages(nextMessages);
    requestAnimationFrame(() => scrollToBottom(true));
    try {
      // Always refresh the live engine URL — model/settings saves restart the
      // process and chatting against a stale port looks like "unreachable".
      let promptEngine = engine;
      let promptSnapshot = snapshot;
      const ready = await ensureEngineReadyForPrompt();
      promptEngine = ready.engine;
      promptSnapshot = ready.snapshot;
      if (mode === 'database') {
        const dbReady = await ensureDatabaseAccessReady(dbAccess);
        promptEngine = dbReady.engine;
        promptSnapshot = dbReady.snapshot;
      }
      if (!promptEngine || !promptSnapshot) {
        throw new Error('Engine is not ready. Try again in a moment.');
      }

      let activeThread = threadId;
      if (!activeThread && promptEngine) {
        const created = await postHistory({
          ...promptEngine,
          body: { action: 'new', title: prompt.slice(0, 48) },
        });
        activeThread = created.activeThreadId;
        setThreadId(activeThread);
        setHistory(created.threads as HistoryThread[]);
      }

      const carryMode: 'ask' | 'plan' | 'agent' =
        runMode === 'database'
          ? dbAccess === 'readwrite'
            ? 'agent'
            : 'ask'
          : runMode === 'plan' || runMode === 'agent'
            ? runMode
            : 'ask';

      const approvedPlan =
        override?.approvedPlan ??
        resolvePlanHandoff({
          mode: carryMode,
          pendingPlan,
        });
      const approvedPlanStrategy =
        override && 'approvedPlanStrategy' in override
          ? override.approvedPlanStrategy ?? undefined
          : resolvePlanStrategyHandoff({
              mode: carryMode,
              pendingPlanStrategy,
            });
      const taskList =
        override && 'taskList' in override
          ? override.taskList ?? undefined
          : carryMode === 'agent'
            ? pendingTaskList ?? undefined
            : undefined;

      const provider = promptSnapshot.settings.provider;
      const carryBudget = deriveLiveTokenBudgetPreview({
        contextWindowTokens: resolveEffectiveContextWindow(
          typeof provider?.contextWindow === 'number'
            ? provider.contextWindow
            : 0,
          provider?.model ?? '',
          provider?.type,
        ),
      });
      const conversation = buildConversationCarry({
        messages: messages.map((m) => ({ role: m.role, text: m.text })),
        currentPrompt: prompt,
        mode: carryMode,
        structured:
          carryMode === 'agent'
            ? collectStructuredCarryFromThread({
                messages,
                pendingPlan: approvedPlan ?? pendingPlan,
                pendingTaskList: taskList ?? pendingTaskList,
              })
            : undefined,
        limits: {
          maxMessages: carryBudget.carryMaxMessages,
          maxCharsPerMessage: carryBudget.carryMaxCharsPerMessage,
        },
      });

      const runPromptStream = (snap: DesktopShellSnapshot) =>
        consumeStream(
          streamPrompt({
            baseUrl: snap.engineBaseUrl,
            prompt,
            mode: runMode,
            model: snap.settings.provider.model,
            sessionId: activeThread,
            approvalPreset: approvalMode,
            thoroughness,
            ...(mode === 'database' ? { dbAccess } : {}),
            pinnedPaths: submitPinnedPaths,
            requiredSkillIds: pinnedSkillIds,
            requiredMcpServerIds: pinnedMcpIds,
            signal,
            ...(conversation.length > 0 ? { conversation } : {}),
            ...(approvedPlan ? { approvedPlan } : {}),
            ...(approvedPlanStrategy
              ? { approvedPlanStrategy }
              : {}),
            ...(taskList ? { taskList } : {}),
            ...(completedPlanStepIds.size > 0
              ? { completedPlanStepIds: [...completedPlanStepIds] }
              : {}),
            ...(snap.authToken ? { token: snap.authToken } : {}),
          }),
          assistantId,
          { formatPlanAnswer: runMode === 'plan' },
        );

      let streamResult: Awaited<ReturnType<typeof runPromptStream>>;
      try {
        streamResult = await runPromptStream(promptSnapshot);
      } catch (err) {
        if (
          shouldIgnoreRunError(err, signal) ||
          !isTransientEngineNetworkError(err)
        ) {
          throw err;
        }
        const retried = await ensureEngineReadyForPrompt();
        promptSnapshot = retried.snapshot;
        streamResult = await runPromptStream(promptSnapshot);
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

      const hasOpenSliceWorkPreview =
        Boolean(resultNextActionPrompt) ||
        (typeof resultPendingCount === 'number' && resultPendingCount > 0) ||
        Boolean(
          resultTaskList?.items.some(
            (item) => item.status === 'pending' || item.status === 'active',
          ),
        );
      let finalAssistant = hasOpenSliceWorkPreview
        ? stripContinueCtaFromAnswer(assistant)
        : assistant;
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
                activity,
                ...(fileChanges ? { fileChanges } : {}),
                streaming: false,
              }
            : m,
        ),
      );

      const usedPlanHandoff = Boolean(approvedPlan) && runMode === 'agent';
      const hasOpenSliceWork =
        Boolean(resultNextActionPrompt) ||
        (typeof resultPendingCount === 'number' && resultPendingCount > 0) ||
        Boolean(
          resultTaskList?.items.some(
            (item) => item.status === 'pending' || item.status === 'active',
          ),
        );
      let planPersist:
        | {
            pendingPlan?: PlanArtifact | null;
            pendingPlanStrategy?: PlanStrategyDecision | null;
            pendingTaskList?: TaskList | null;
            completedPlanStepIds?: string[] | null;
            pendingNextActionPrompt?: string | null;
            clearPendingPlan?: boolean;
          }
        | undefined;

      // Visible plan UI (PlanFollowStrip / PendingPlanBanner) needs pendingPlan
      // for both Plan and Agent — Agent used to drop the artifact entirely.
      const pendingFromRun =
        resultPlan ??
        (runMode === 'plan'
          ? synthesizePlanArtifactFromAnswer(finalAssistant)
          : undefined);

      if (resultCompletedIds?.length) {
        setCompletedPlanStepIds(new Set(resultCompletedIds));
      }
      if (resultNextActionPrompt) {
        setPendingNextActionPrompt(resultNextActionPrompt);
      } else if (!hasOpenSliceWork) {
        setPendingNextActionPrompt(null);
      }

      if (pendingFromRun) {
        setPendingPlan(pendingFromRun);
        setPendingPlanStrategy(resultPlanStrategy ?? null);
        setPendingTaskList(resultTaskList ?? null);
        planPersist = {
          pendingPlan: pendingFromRun,
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
        // Partial slice — keep the checklist / next CTA; do not clear on Build handoff.
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
      } else if (usedPlanHandoff || override?.clearPendingPlanAfter) {
        setPendingPlan(null);
        setPendingPlanStrategy(null);
        setPendingTaskList(null);
        setCompletedPlanStepIds(new Set());
        setPendingNextActionPrompt(null);
        planPersist = { clearPendingPlan: true };
      } else if (resultTaskList || resultNextActionPrompt) {
        if (resultTaskList) setPendingTaskList(resultTaskList);
        planPersist = {
          ...(resultTaskList ? { pendingTaskList: resultTaskList } : {}),
          ...(resultCompletedIds?.length
            ? { completedPlanStepIds: resultCompletedIds }
            : {}),
          ...(resultNextActionPrompt
            ? { pendingNextActionPrompt: resultNextActionPrompt }
            : hasOpenSliceWork
              ? {}
              : { pendingNextActionPrompt: null }),
        };
      }

      await persistMessages(
        nextMessages.map((m) =>
          m.id === assistantId
            ? {
                ...m,
                text: finalAssistant,
                activity,
                ...(fileChanges ? { fileChanges } : {}),
                streaming: false,
              }
            : m,
        ),
        activeThread,
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
  }, [
    approvalMode,
    busy,
    consumeStream,
    dbAccess,
    editorContext,
    dbAccess,
    engine,
    ensureDatabaseAccessReady,
    ensureEngineReadyForPrompt,
    input,
    messages,
    mode,
    needsModel,
    pendingPlan,
    pendingPlanStrategy,
    pendingTaskList,
    completedPlanStepIds,
    pinnedMcpIds,
    pinnedPaths,
    pinnedSkillIds,
    resolveFileChanges,
    snapshotDirtyPaths,
    scrollToBottom,
    settings.ui.contextToggles,
    snapshot,
    thoroughness,
    threadId,
  ]);

  return {
    onSubmit,
  };
}
