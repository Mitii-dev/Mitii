/** Initial snapshot load and per-workspace history / profile / catalog bootstrap. */

import { useEffect } from 'react';
import {
  fetchHistory,
  postHistory,
  fetchIndexStatus,
  fetchProfiles,
  fetchProviderModels,
  fetchSkills,
  fetchMcpServers,
} from '../../api.js';
import { emptyTokenUsage } from '@mitii/ui-react';
import {
  type PlanArtifact,
  type PlanStrategyDecision,
  type TaskList,
} from '../../../shared/planFormat.js';
import type { useEngineLifecycle } from './useEngineLifecycle.js';
import type { useEngineSnapshot } from './useEngineSnapshot.js';
import type { useChatThreadState } from '../../chat/hooks/useChatThreadState.js';
import type { useShellUiState } from './useShellUiState.js';
import type { useIndexState } from '../../indexing/hooks/useIndexState.js';
import type { useProviderState } from '../../settings/hooks/useProviderState.js';
import { type HistoryThread, type ChatMessage } from '../../chat/chatTypes.js';
import { tokenUsageFromThread } from '../../chat/threadHistory.js';
import { type ProfileRow } from '../../settings/profileTypes.js';

export function useWorkspaceBootstrap(deps: Pick<
    ReturnType<typeof useEngineLifecycle>,
    'refresh'
  > &
  Pick<
    ReturnType<typeof useEngineSnapshot>,
    'setError' | 'engine' | 'snapshot'
  > &
  Pick<
    ReturnType<typeof useChatThreadState>,
    'historyWorkspaceRef' | 'setHistory' | 'setHistoryLoading' | 'pendingThreadRef'
    | 'pendingNewChatRef' | 'setThreadId' | 'setMessages' | 'setPendingPlan'
    | 'setPendingPlanStrategy' | 'setPendingTaskList' | 'setCompletedPlanStepIds'
    | 'setPendingNextActionPrompt' | 'setTokenUsage' | 'setSuspension'
  > &
  Pick<
    ReturnType<typeof useShellUiState>,
    'setView'
  > &
  Pick<
    ReturnType<typeof useIndexState>,
    'setIndexStatus' | 'setIndexIndexing' | 'setIndexProgress'
  > &
  Pick<
    ReturnType<typeof useProviderState>,
    'setProfiles' | 'setActiveProfileId' | 'setKnownModels' | 'modelsProfileRef'
    | 'setModelsLoading' | 'setSkills' | 'setMcpMasterEnabled' | 'setMcpServers'
    | 'setMcpStatusReady'
  >) {
  const {
    refresh,
    setError,
    engine,
    snapshot,
    historyWorkspaceRef,
    setHistory,
    setHistoryLoading,
    pendingThreadRef,
    pendingNewChatRef,
    setThreadId,
    setMessages,
    setPendingPlan,
    setPendingPlanStrategy,
    setPendingTaskList,
    setCompletedPlanStepIds,
    setPendingNextActionPrompt,
    setTokenUsage,
    setSuspension,
    setView,
    setIndexStatus,
    setIndexIndexing,
    setIndexProgress,
    setProfiles,
    setActiveProfileId,
    setKnownModels,
    modelsProfileRef,
    setModelsLoading,
    setSkills,
    setMcpMasterEnabled,
    setMcpServers,
    setMcpStatusReady,
  } = deps;

  useEffect(() => {
    void refresh().catch((err: unknown) => {
      setError(err instanceof Error ? err.message : String(err));
    });
  }, [refresh]);

  useEffect(() => {
    if (!engine) return;
    // History is workspace-scoped — only reload when the folder changes,
    // not when the engine restarts after settings save (that wiped the list).
    let cancelled = false;
    const workspaceRoot = snapshot?.workspaceRoot;
    const workspaceChanged = historyWorkspaceRef.current !== workspaceRoot;
    if (workspaceChanged) {
      historyWorkspaceRef.current = workspaceRoot;
      setHistory([]);
      setHistoryLoading(true);
    } else {
      setHistoryLoading(true);
    }

    void fetchHistory(engine)
      .then(async (store) => {
        if (cancelled) return;
        let threads = store.threads as HistoryThread[];
        let activeId = store.activeThreadId ?? threads[0]?.id;
        const pending = pendingThreadRef.current;
        const wantNew = pendingNewChatRef.current;

        if (wantNew) {
          pendingNewChatRef.current = false;
          pendingThreadRef.current = null;
          try {
            const created = await postHistory({
              ...engine,
              body: { action: 'new', title: 'New chat' },
            });
            if (cancelled) return;
            threads = created.threads as HistoryThread[];
            activeId = created.activeThreadId ?? threads[0]?.id;
            setHistory(threads);
            setThreadId(activeId);
            setMessages([]);
            setPendingPlan(null);
            setPendingPlanStrategy(null);
            setPendingTaskList(null);
            setCompletedPlanStepIds(new Set());
            setPendingNextActionPrompt(null);
            setTokenUsage(emptyTokenUsage());
            setSuspension(null);
            setView('chat');
            return;
          } catch {
            /* fall through to normal load */
          }
        }

        if (pending && threads.some((t) => t.id === pending)) {
          pendingThreadRef.current = null;
          try {
            const activated = await postHistory({
              ...engine,
              body: { action: 'activate', threadId: pending },
            });
            if (cancelled) return;
            threads = activated.threads as HistoryThread[];
            activeId = pending;
          } catch {
            pendingThreadRef.current = null;
          }
        } else if (pending) {
          pendingThreadRef.current = null;
        }

        // Always replace after a workspace change; on engine-only restart,
        // keep prior threads if the fetch raced empty.
        setHistory((prev) => {
          if (workspaceChanged) return threads;
          return threads.length > 0 || prev.length === 0 ? threads : prev;
        });
        const active = threads.find((t) => t.id === activeId);
        setThreadId((current) => {
          if (workspaceChanged || pending) return activeId;
          if (current) return current;
          return activeId;
        });
        setMessages((current) => {
          if (workspaceChanged || pending) {
            return active ? (active.messages as ChatMessage[]) : [];
          }
          if (current.length > 0) return current;
          return active ? (active.messages as ChatMessage[]) : current;
        });
        if (workspaceChanged || pending) {
          setPendingPlan(
            (active?.pendingPlan as PlanArtifact | undefined) ?? null,
          );
          setPendingPlanStrategy(
            (active?.pendingPlanStrategy as
              | PlanStrategyDecision
              | undefined) ?? null,
          );
          setPendingTaskList(
            (active?.pendingTaskList as TaskList | undefined) ?? null,
          );
          setCompletedPlanStepIds(
            new Set(
              Array.isArray(active?.completedPlanStepIds)
                ? active.completedPlanStepIds.filter(
                    (id): id is string => typeof id === 'string',
                  )
                : [],
            ),
          );
          setPendingNextActionPrompt(
            typeof active?.pendingNextActionPrompt === 'string'
              ? active.pendingNextActionPrompt
              : null,
          );
          setTokenUsage(tokenUsageFromThread(active));
        } else {
          if (active?.pendingPlan) {
            setPendingPlan(active.pendingPlan as PlanArtifact);
            setPendingPlanStrategy(
              (active.pendingPlanStrategy as
                | PlanStrategyDecision
                | undefined) ?? null,
            );
            setPendingTaskList(
              (active.pendingTaskList as TaskList | undefined) ?? null,
            );
            setCompletedPlanStepIds(
              new Set(
                Array.isArray(active.completedPlanStepIds)
                  ? active.completedPlanStepIds.filter(
                      (id): id is string => typeof id === 'string',
                    )
                  : [],
              ),
            );
            setPendingNextActionPrompt(
              typeof active.pendingNextActionPrompt === 'string'
                ? active.pendingNextActionPrompt
                : null,
            );
          }
          setTokenUsage((current) => {
            if (
              current.sessionTotal > 0 ||
              current.modelCalls > 0 ||
              current.toolCalls > 0
            ) {
              return current;
            }
            return tokenUsageFromThread(active, current.contextWindow);
          });
        }
      })
      .catch(() => {
        if (workspaceChanged && !cancelled) setHistory([]);
      })
      .finally(() => {
        if (!cancelled) setHistoryLoading(false);
      });
    void fetchIndexStatus(engine)
      .then((s) => {
        if (cancelled) return;
        setIndexStatus({
          indexed: s.indexed,
          fileCount: s.fileCount,
          truncated: s.truncated,
          lastIndexedAt: s.lastIndexedAt,
          message: s.message,
          embeddingError: s.embeddingError,
          running: s.running,
          ...(s.health ? { health: s.health } : {}),
        });
        if (s.running) {
          setIndexIndexing(true);
          if (typeof s.progressPercent === 'number') {
            setIndexProgress(s.progressPercent);
          }
        } else {
          setIndexIndexing(false);
          setIndexProgress(null);
        }
      })
      .catch(() => {
        if (!cancelled) setIndexStatus(null);
      });
    void fetchProfiles(engine)
      .then(async (store) => {
        if (cancelled) return;
        setProfiles(store.profiles as ProfileRow[]);
        setActiveProfileId(store.activeProfileId);
        const active =
          store.profiles.find((p) => p.id === store.activeProfileId) ??
          store.profiles[0];
        if (!active) {
          setKnownModels([]);
          modelsProfileRef.current = '';
          return;
        }
        modelsProfileRef.current = active.id;
        setModelsLoading(true);
        setKnownModels(
          active.provider.model?.trim() ? [active.provider.model.trim()] : [],
        );
        try {
          const listed = await fetchProviderModels({
            ...engine,
            type: active.provider.type || 'openai-compatible',
            providerBaseUrl: active.provider.baseUrl,
          });
          if (cancelled || modelsProfileRef.current !== active.id) return;
          const selected = active.provider.model?.trim();
          const next = Array.from(
            new Set([
              ...(selected ? [selected] : []),
              ...listed.map((id) => id.trim()).filter(Boolean),
            ]),
          );
          setKnownModels(next);
        } catch {
          if (!cancelled && modelsProfileRef.current === active.id) {
            setKnownModels(
              active.provider.model?.trim()
                ? [active.provider.model.trim()]
                : [],
            );
          }
        } finally {
          if (!cancelled && modelsProfileRef.current === active.id) {
            setModelsLoading(false);
          }
        }
      })
      .catch(() => undefined);
    void fetchSkills(engine)
      .then((list) => {
        if (!cancelled) setSkills(list);
      })
      .catch(() => undefined);
    void fetchMcpServers(engine)
      .then((payload) => {
        if (!cancelled) {
          setMcpMasterEnabled(Boolean(payload.enabled));
          setMcpServers(payload.servers ?? []);
          setMcpStatusReady(true);
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [snapshot?.workspaceRoot, snapshot?.engineBaseUrl]);
}
