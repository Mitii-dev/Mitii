import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';

import {
  appendActivity,
  runEventToActivity,
  type DesktopActivityItem,
} from '../shared/activity.js';
import type {
  DesktopShellSnapshot,
} from '../shared/bridge.js';
import type {
  DesktopAgentMode,
  DesktopPromptStreamLine,
} from '../shared/protocol.js';
import {
  DEFAULT_DESKTOP_SETTINGS,
  SETTINGS_TABS,
  mergeDesktopSettings,
  normalizeDesktopProviderModel,
  type DesktopSettings,
  type SettingsTabId,
} from '../shared/settings.js';
import {
  extractSuspension,
  type DesktopSuspension,
} from '../shared/suspension.js';
import {
  collectMutatedPathsFromEvent,
  type DesktopFileChanges,
} from '../shared/fileChanges.js';
import { breakdownFromPromptReady } from '../shared/contextUsage.js';
import logoUrl from './assets/mitii-logo.svg';
import { ActivityBarButton } from './ActivityBarButton.js';
import {
  IconChat,
  IconCode,
  IconContext,
  IconDeveloper,
  IconFeatures,
  IconFiles,
  IconGit,
  IconMcp,
  IconPlus,
  IconProvider,
  IconRecipes,
  IconSettings,
  IconSkills,
  IconSwitch,
  IconUser,
  IconWorkspace,
} from './ActivityIcons.js';
import { ActivityTimeline } from './ActivityTimeline.js';
import {
  extractAssistantText,
  deleteHistoryThread,
  fetchFileChanges,
  fetchHistory,
  fetchIndexStatus,
  fetchMcpServers,
  fetchProfiles,
  fetchProviderModels,
  fetchSkills,
  finalizeAssistantText,
  getDesktopBridge,
  postHistory,
  postProfiles,
  reindexWorkspace,
  searchWorkspacePaths,
  shortPath,
  streamPrompt,
  streamResume,
  workspaceLabel,
} from './api.js';
import { ChatHistoryNav } from './ChatHistoryNav.js';
import { IndexStatusChip } from './IndexStatusChip.js';
import { FileChangesCard } from './FileChangesCard.js';
import { IdentityPicker } from './IdentityPicker.js';
import { ApprovalCard } from './ApprovalCard.js';
import {
  ComposerControls,
  modeAccent,
  type ApprovalUiMode,
  type ThoroughnessUi,
} from './ComposerControls.js';
import { MarkdownBody } from './MarkdownBody.js';
import { McpAppCard, mcpAppsFromActivity } from './McpAppCard.js';
import { ModelQuickSelect } from './ModelQuickSelect.js';
import {
  detectMentionSuggest,
  stripTrailingMention,
  type MentionSuggestState,
} from './mentionSuggest.js';
import { SettingsPanel } from './SettingsPanel.js';
import { ResizeHandle, usePersistedWidth } from './ResizeHandle.js';
import { WorkspacePanel } from './WorkspacePanel.js';
import {
  addTurnTokens,
  emptyTokenUsage,
  TokenMeter,
  type TokenUsageState,
} from './TokenMeter.js';

type View = 'chat' | 'settings';
type ChatLayout = 'chat' | 'code';

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  mode?: string;
  activity?: DesktopActivityItem[];
  fileChanges?: DesktopFileChanges;
  streaming?: boolean;
}

interface HistoryThread {
  id: string;
  title: string;
  updatedAt: string;
  messages: ChatMessage[];
  tokenUsage?: TokenUsageState;
}

function serializeTokenUsage(usage: TokenUsageState): TokenUsageState {
  const {
    live: _live,
    inputTokensTotal,
    outputTokensTotal,
    sessionTotal,
    modelCalls,
    toolCalls,
    turnCount,
    lastPromptTokens,
    lastResponseTokens,
    currentTurnTotal,
    contextWindow,
    durationMs,
    contextBreakdown,
  } = usage;
  return {
    inputTokensTotal,
    outputTokensTotal,
    sessionTotal:
      sessionTotal || inputTokensTotal + outputTokensTotal,
    modelCalls,
    toolCalls,
    turnCount,
    lastPromptTokens,
    lastResponseTokens,
    currentTurnTotal,
    contextWindow,
    ...(typeof durationMs === 'number' && durationMs > 0
      ? { durationMs }
      : {}),
    ...(contextBreakdown ? { contextBreakdown } : {}),
  };
}

function tokenUsageFromThread(
  thread: HistoryThread | undefined,
  contextWindow = 0,
): TokenUsageState {
  if (!thread?.tokenUsage) {
    return emptyTokenUsage(contextWindow);
  }
  const usage = serializeTokenUsage(thread.tokenUsage);
  return {
    ...usage,
    contextWindow: usage.contextWindow || contextWindow,
    live: false,
  };
}

interface ProfileRow {
  id: string;
  name: string;
  provider: {
    type?: string;
    model: string;
    preset?: string;
    baseUrl?: string;
    contextWindow?: number;
    maximumOutputTokens?: number;
  };
  hasSecret?: boolean;
}

function extractTurnTokens(event: unknown): { in: number; out: number } | null {
  if (!event || typeof event !== 'object') return null;
  const e = event as Record<string, unknown>;
  if (e.type !== 'model_turn') return null;
  const input = typeof e.inputTokens === 'number' ? e.inputTokens : 0;
  const output = typeof e.outputTokens === 'number' ? e.outputTokens : 0;
  return { in: input, out: output };
}

function isToolCompleted(event: unknown): boolean {
  return Boolean(
    event &&
      typeof event === 'object' &&
      (event as Record<string, unknown>).type === 'tool_completed',
  );
}

const SETTINGS_TAB_ICONS: Record<
  SettingsTabId,
  (props: { size?: number }) => JSX.Element
> = {
  storage: IconWorkspace,
  workspaces: IconFiles,
  profiles: IconProvider,
  context: IconContext,
  features: IconFeatures,
  debug: IconDeveloper,
};

export function App() {
  const [view, setView] = useState<View>('chat');
  const [chatLayout, setChatLayout] = useState<ChatLayout>(() => {
    try {
      const v = localStorage.getItem('mitii.desktop.chatLayout');
      return v === 'code' ? 'code' : 'chat';
    } catch {
      return 'chat';
    }
  });
  const [sideWidth, setSideWidth] = usePersistedWidth('mitii.desktop.sideWidth', {
    initial: 232,
    min: 160,
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
  const [workspaceSide, setWorkspaceSide] = useState<
    'explorer' | 'git' | 'mcp' | 'skills' | 'recipes'
  >('explorer');
  const [settingsTab, setSettingsTab] = useState<SettingsTabId>('profiles');
  const [picker, setPicker] = useState<'workspace' | 'profile' | null>(null);
  const [gitBadge, setGitBadge] = useState(0);
  const [snapshot, setSnapshot] = useState<DesktopShellSnapshot | null>(null);
  const [mode, setMode] = useState<DesktopAgentMode>('ask');
  const [approvalMode, setApprovalMode] = useState<ApprovalUiMode>('guided');
  const [thoroughness, setThoroughness] = useState<ThoroughnessUi>('medium');
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [threadId, setThreadId] = useState<string | undefined>();
  const [history, setHistory] = useState<HistoryThread[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [indexStatus, setIndexStatus] = useState<{
    indexed: boolean;
    fileCount: number;
    truncated: boolean;
    lastIndexedAt?: string;
    message: string;
    embeddingError?: string;
  } | null>(null);
  const [indexIndexing, setIndexIndexing] = useState(false);
  const [indexProgress, setIndexProgress] = useState<number | null>(null);
  const [indexStream, setIndexStream] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tokenUsage, setTokenUsage] = useState<TokenUsageState>(emptyTokenUsage);
  const tokenUsageRef = useRef<TokenUsageState>(emptyTokenUsage());
  const [profiles, setProfiles] = useState<ProfileRow[]>([]);
  const [activeProfileId, setActiveProfileId] = useState('');
  const [knownModels, setKnownModels] = useState<string[]>([]);
  const [modelsLoading, setModelsLoading] = useState(false);
  const modelsProfileRef = useRef<string>('');
  const [suspension, setSuspension] = useState<DesktopSuspension | null>(null);
  const [pinnedPaths, setPinnedPaths] = useState<string[]>([]);
  const [pinnedSkillIds, setPinnedSkillIds] = useState<string[]>([]);
  const [pinnedMcpIds, setPinnedMcpIds] = useState<string[]>([]);
  const [skills, setSkills] = useState<
    Array<{ id: string; title: string; description: string }>
  >([]);
  const [mcpServers, setMcpServers] = useState<
    Array<{ id: string; name: string; enabled: boolean }>
  >([]);
  const [pinMenu, setPinMenu] = useState(false);
  const [mention, setMention] = useState<MentionSuggestState | null>(null);
  const [pathHits, setPathHits] = useState<string[]>([]);
  const [suggestIndex, setSuggestIndex] = useState(0);
  const [suggestLoading, setSuggestLoading] = useState(false);
  const feedRef = useRef<HTMLDivElement>(null);
  const feedEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const pinMenuRef = useRef<HTMLFormElement>(null);
  const searchReq = useRef(0);
  const pendingThreadRef = useRef<string | null>(null);
  const pendingNewChatRef = useRef(false);
  const historyWorkspaceRef = useRef<string | undefined>(undefined);

  const engine = snapshot
    ? { baseUrl: snapshot.engineBaseUrl, token: snapshot.authToken }
    : null;

  const needsModel = !snapshot?.settings.provider.model?.trim();
  const settings =
    snapshot?.settings ?? mergeDesktopSettings(DEFAULT_DESKTOP_SETTINGS);
  const modelLabel =
    settings.provider.model.trim() || settings.provider.preset || 'Model';
  const accent = modeAccent(mode);
  const activeProfile =
    profiles.find((p) => p.id === activeProfileId) ?? profiles[0];

  const scrollToBottom = useCallback((smooth = false) => {
    const end = feedEndRef.current;
    if (!end) return;
    end.scrollIntoView({
      behavior: smooth ? 'smooth' : 'auto',
      block: 'end',
    });
  }, []);

  useEffect(() => {
    scrollToBottom(false);
  }, [messages, suspension, scrollToBottom]);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = '0px';
    el.style.height = `${Math.min(160, Math.max(24, el.scrollHeight))}px`;
  }, [input]);

  useEffect(() => {
    if (!pinMenu) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!pinMenuRef.current?.contains(event.target as Node)) {
        setPinMenu(false);
        setMention(null);
        setPathHits([]);
        setSuggestIndex(0);
        setSuggestLoading(false);
      }
    };
    window.addEventListener('pointerdown', onPointerDown);
    return () => window.removeEventListener('pointerdown', onPointerDown);
  }, [pinMenu]);

  const refresh = useCallback(async () => {
    const bridge = getDesktopBridge();
    if (!bridge) {
      setError('Desktop bridge missing. Rebuild and relaunch.');
      return;
    }
    setSnapshot(await bridge.getSnapshot());
    setError(null);
  }, []);

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
          setTokenUsage(tokenUsageFromThread(active));
        } else {
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
          embeddingError: undefined,
        });
        setIndexIndexing(false);
        setIndexProgress(null);
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
        if (!cancelled) setMcpServers(payload.servers ?? []);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [snapshot?.workspaceRoot, snapshot?.engineBaseUrl]);

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
        messages: nextMessages.map(({ streaming: _s, ...rest }) => rest),
        title: nextMessages.find((m) => m.role === 'user')?.text.slice(0, 48),
        tokenUsage: tokenSnapshot,
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

  const consumeStream = useCallback(
    async (
      lines: AsyncIterable<DesktopPromptStreamLine>,
      assistantId: string,
    ): Promise<{
      assistant: string;
      activity: DesktopActivityItem[];
      suspension: DesktopSuspension | null;
      mutatedPaths: string[];
      tokenUsage: TokenUsageState;
    }> => {
      let assistant = '';
      let activity: DesktopActivityItem[] = [];
      let nextSuspension: DesktopSuspension | null = null;
      const mutated = new Set<string>();
      let usage: TokenUsageState = { ...tokenUsageRef.current, live: true };

      const pushUsage = (next: TokenUsageState) => {
        usage = next;
        tokenUsageRef.current = next;
        setTokenUsage(next);
      };

      for await (const line of lines) {
        if (line.op === 'error') {
          throw new Error(line.message ?? line.error);
        }
        if (line.op === 'event') {
          const tokens = extractTurnTokens(line.event);
          if (tokens) {
            pushUsage(addTurnTokens({ ...usage, live: true }, tokens.in, tokens.out));
          }
          const breakdown = breakdownFromPromptReady(line.event);
          if (breakdown) {
            pushUsage({
              ...usage,
              contextBreakdown: breakdown,
              contextWindow: breakdown.contextWindow || usage.contextWindow,
              live: true,
            });
          }
          if (isToolCompleted(line.event)) {
            pushUsage({
              ...usage,
              toolCalls: usage.toolCalls + 1,
            });
          }
          for (const path of collectMutatedPathsFromEvent(line.event)) {
            mutated.add(path);
          }
          const item = runEventToActivity(line.event);
          if (item) {
            activity = appendActivity(activity, item);
          }
          const delta = extractAssistantText(line);
          if (delta) assistant += delta;
          const text = assistant;
          const activitySnapshot = activity;
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantId
                ? {
                    ...m,
                    text,
                    activity: activitySnapshot,
                    streaming: true,
                  }
                : m,
            ),
          );
        }
        if (line.op === 'result') {
          assistant = finalizeAssistantText(assistant, line);
          nextSuspension = extractSuspension(line.result);
          if (nextSuspension) {
            setSuspension(nextSuspension);
          }
          const activitySnapshot = activity;
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantId
                ? {
                    ...m,
                    text: assistant,
                    activity: activitySnapshot,
                    streaming: false,
                  }
                : m,
            ),
          );
          pushUsage({ ...usage, live: false });
        }
      }

      return {
        assistant,
        activity,
        suspension: nextSuspension,
        mutatedPaths: [...mutated],
        tokenUsage: { ...usage, live: false },
      };
    },
    [],
  );

  const resolveFileChanges = useCallback(
    async (paths: string[]): Promise<DesktopFileChanges | undefined> => {
      if (!engine || paths.length === 0) return undefined;
      try {
        return await fetchFileChanges({ ...engine, paths });
      } catch {
        return {
          files: paths.map((path) => ({
            path,
            status: 'M' as const,
            additions: 0,
            deletions: 0,
          })),
          totalAdditions: 0,
          totalDeletions: 0,
        };
      }
    },
    [engine],
  );

  const resetChatForWorkspaceSwitch = () => {
    setMessages([]);
    setThreadId(undefined);
    setHistory([]);
    setHistoryLoading(true);
    setTokenUsage(emptyTokenUsage());
    setSuspension(null);
    setPinnedPaths([]);
    setPinnedSkillIds([]);
    setPinnedMcpIds([]);
    setIndexStatus(null);
    setIndexIndexing(false);
    setIndexProgress(null);
    setIndexStream([]);
  };

  const pushIndexStream = useCallback((line: string) => {
    const stamp = new Date().toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    setIndexStream((prev) => {
      const last = prev[prev.length - 1];
      if (last && last.endsWith(line)) return prev;
      return [...prev.slice(-80), `${stamp}  ${line}`];
    });
  }, []);

  const refreshIndexStatus = useCallback(async () => {
    if (!engine) return;
    try {
      const s = await fetchIndexStatus(engine);
      setIndexStatus({
        indexed: s.indexed,
        fileCount: s.fileCount,
        truncated: s.truncated,
        lastIndexedAt: s.lastIndexedAt,
        message: s.message,
      });
      return s;
    } catch {
      /* non-fatal */
      return null;
    } finally {
      setIndexIndexing(false);
      setIndexProgress(null);
    }
  }, [engine]);

  const runReindex = useCallback(async () => {
    if (!engine || !snapshot) return;
    setIndexIndexing(true);
    setIndexProgress(6);
    setIndexStream([]);
    pushIndexStream('Reindex started…');
    const tick = window.setInterval(() => {
      setIndexProgress((p) => {
        if (p == null) return 12;
        return Math.min(92, p + Math.random() * 10);
      });
    }, 400);
    const poll = window.setInterval(() => {
      void fetchIndexStatus(engine)
        .then((s) => {
          setIndexStatus({
            indexed: s.indexed,
            fileCount: s.fileCount,
            truncated: s.truncated,
            lastIndexedAt: s.lastIndexedAt,
            message: s.message,
          });
          if (s.message) pushIndexStream(s.message);
          if (s.fileCount > 0) {
            pushIndexStream(`${s.fileCount.toLocaleString()} files scanned`);
          }
        })
        .catch(() => undefined);
    }, 900);
    try {
      const result = await reindexWorkspace({
        ...engine,
        maximumFiles: settings.workspace.maximumIndexFiles || undefined,
        semanticIndex: {
          enabled: settings.semanticIndex.enabled,
          source: settings.semanticIndex.source,
          model: settings.semanticIndex.model,
          dimensions: settings.semanticIndex.dimensions,
          normalized: settings.semanticIndex.normalized,
          baseUrl: settings.provider.baseUrl,
        },
      });
      setIndexProgress(100);
      pushIndexStream(result.message || 'Reindex finished');
      if (result.fileCount > 0) {
        pushIndexStream(
          `${result.fileCount.toLocaleString()} files in index`,
        );
      }
      await refreshIndexStatus();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      pushIndexStream(`Error: ${msg}`);
      setIndexIndexing(false);
      setIndexProgress(null);
    } finally {
      window.clearInterval(tick);
      window.clearInterval(poll);
    }
  }, [engine, snapshot, settings, refreshIndexStatus, pushIndexStream]);

  useEffect(() => {
    if (!indexIndexing) return;
    const tick = window.setInterval(() => {
      setIndexProgress((p) => {
        if (p == null) return 10;
        if (p >= 92) return p;
        return p + Math.random() * 8;
      });
    }, 450);
    return () => window.clearInterval(tick);
  }, [indexIndexing]);

  const onPickWorkspace = async () => {
    const bridge = getDesktopBridge();
    if (!bridge) return;
    setBusy(true);
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
    }
  };

  const closeSuggest = () => {
    setPinMenu(false);
    setMention(null);
    setPathHits([]);
    setSuggestIndex(0);
    setSuggestLoading(false);
  };

  const updateMentionFromInput = (value: string) => {
    const next = detectMentionSuggest(value);
    setMention(next);
    setSuggestIndex(0);
    if (!next) {
      setPinMenu(false);
      setPathHits([]);
      return;
    }
    setPinMenu(true);
    if (next.mode === 'all' || next.mode === 'path') {
      if (!engine) {
        setPathHits([]);
        return;
      }
      const req = ++searchReq.current;
      setSuggestLoading(true);
      void searchWorkspacePaths({
        ...engine,
        query: next.query,
      })
        .then((paths) => {
          if (req !== searchReq.current) return;
          setPathHits(paths);
        })
        .catch(() => {
          if (req !== searchReq.current) return;
          setPathHits([]);
        })
        .finally(() => {
          if (req === searchReq.current) setSuggestLoading(false);
        });
    } else {
      setPathHits([]);
      setSuggestLoading(false);
    }
  };

  type SuggestItem =
    | { kind: 'file'; path: string }
    | { kind: 'skill'; id: string; title: string; description: string }
    | { kind: 'mcp'; id: string; name: string; enabled: boolean };

  const suggestItems: SuggestItem[] = (() => {
    if (!mention) return [];
    const q = mention.query;
    const items: SuggestItem[] = [];
    const wantFiles = mention.mode === 'all' || mention.mode === 'path';
    const wantSkills = mention.mode === 'all' || mention.mode === 'skill';
    const wantMcp = mention.mode === 'all' || mention.mode === 'mcp';

    if (wantSkills) {
      for (const skill of skills) {
        const hay = `${skill.id} ${skill.title} ${skill.description}`.toLowerCase();
        if (!q || hay.includes(q)) {
          items.push({
            kind: 'skill',
            id: skill.id,
            title: skill.title,
            description: skill.description,
          });
        }
      }
    }
    if (wantMcp) {
      for (const server of mcpServers) {
        const hay = `${server.id} ${server.name}`.toLowerCase();
        if (!q || hay.includes(q)) {
          items.push({
            kind: 'mcp',
            id: server.id,
            name: server.name,
            enabled: server.enabled,
          });
        }
      }
    }
    if (wantFiles) {
      for (const path of pathHits) {
        items.push({ kind: 'file', path });
      }
    }
    return items.slice(0, 48);
  })();

  const selectFileMention = (path: string) => {
    setInput((prev) => stripTrailingMention(prev));
    setPinnedPaths((prev) =>
      prev.includes(path) ? prev : [...prev, path].slice(0, 32),
    );
    closeSuggest();
    textareaRef.current?.focus();
  };

  const selectSkillMention = (id: string) => {
    setInput((prev) => stripTrailingMention(prev));
    setPinnedSkillIds((prev) =>
      prev.includes(id) ? prev : [...prev, id].slice(0, 8),
    );
    closeSuggest();
    textareaRef.current?.focus();
  };

  const selectMcpMention = (id: string) => {
    setInput((prev) => stripTrailingMention(prev));
    setPinnedMcpIds((prev) =>
      prev.includes(id) ? prev : [...prev, id].slice(0, 8),
    );
    closeSuggest();
    textareaRef.current?.focus();
  };

  const applySuggestItem = (item: SuggestItem) => {
    if (item.kind === 'file') selectFileMention(item.path);
    else if (item.kind === 'skill') selectSkillMention(item.id);
    else selectMcpMention(item.id);
  };

  const openAtSuggest = () => {
    const el = textareaRef.current;
    const value = input;
    const needsAt = !/(?:^|\s)@[\w./_-]*$/.test(value);
    const next = needsAt
      ? `${value}${value && !/\s$/.test(value) ? ' ' : ''}@`
      : value;
    setInput(next);
    updateMentionFromInput(next);
    requestAnimationFrame(() => {
      el?.focus();
      const len = next.length;
      el?.setSelectionRange(len, len);
    });
  };

  const onSaveSettings = async (inputSave: {
    settings: DesktopSettings;
    apiKey?: string;
    clearApiKey?: boolean;
    searchApiKey?: string;
    clearSearchApiKey?: boolean;
  }) => {
    const bridge = getDesktopBridge();
    if (!bridge) throw new Error('bridge_missing');
    setBusy(true);
    try {
      const result = await bridge.saveSettings(inputSave);
      if (!result.ok) throw new Error(result.reason ?? 'save_failed');
      // Profile upserts are owned by ProfileSettings (with the live engine
      // token). Do not overwrite/create a "Default" profile here — that raced
      // the engine restart and caused profile saves to fail with 401.
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  const onSelectModel = async (model: string) => {
    if (!snapshot || !model.trim()) return;
    const normalized = normalizeDesktopProviderModel(
      model,
      settings.provider.baseUrl,
    );
    const next = mergeDesktopSettings({
      ...settings,
      provider: { ...settings.provider, model: normalized },
    });
    await onSaveSettings({ settings: next });
    setKnownModels((prev) => {
      if (prev.includes(normalized)) return prev;
      return [normalized, ...prev];
    });
  };

  const onModeChange = (next: DesktopAgentMode) => {
    setMode(next);
    const defaults = settings.ui.modeDefaults[next];
    if (!defaults) return;

    const rawThorough = String(defaults.thoroughness ?? 'medium');
    const nextThorough: ThoroughnessUi =
      rawThorough === 'low' || rawThorough === 'quick'
        ? 'low'
        : rawThorough === 'high' || rawThorough === 'thorough'
          ? 'high'
          : 'medium';
    setThoroughness(nextThorough);

    const rawApproval = String(defaults.approvalMode ?? 'guided');
    const nextApproval: ApprovalUiMode =
      rawApproval === 'safe' ||
      rawApproval === 'guided' ||
      rawApproval === 'pilot'
        ? rawApproval
        : 'guided';
    setApprovalMode(nextApproval);

    const nextModel = defaults.model?.trim();
    if (nextModel) {
      void onSelectModel(nextModel);
    }
  };

  const refreshModelsForActiveProfile = useCallback(
    async (profile?: ProfileRow | null, engineOpts?: typeof engine) => {
      const target =
        profile ??
        profiles.find((p) => p.id === activeProfileId) ??
        profiles[0] ??
        null;
      const opts = engineOpts ?? engine;
      if (!target || !opts) return;
      const requestId = target.id;
      modelsProfileRef.current = requestId;
      setModelsLoading(true);
      // Clear other profiles' models immediately — no mix-match.
      setKnownModels(
        target.provider.model?.trim() ? [target.provider.model.trim()] : [],
      );
      try {
        const listed = await fetchProviderModels({
          ...opts,
          type: target.provider.type || 'openai-compatible',
          providerBaseUrl: target.provider.baseUrl,
        });
        if (modelsProfileRef.current !== requestId) return;
        const selected = normalizeDesktopProviderModel(
          target.provider.model ?? '',
          target.provider.baseUrl,
        );
        const next = Array.from(
          new Set([
            ...(selected ? [selected] : []),
            ...listed
              .map((id) =>
                normalizeDesktopProviderModel(id.trim(), target.provider.baseUrl),
              )
              .filter(Boolean),
          ]),
        );
        setKnownModels(next);
      } catch {
        if (modelsProfileRef.current === requestId) {
          setKnownModels(
            target.provider.model?.trim()
              ? [target.provider.model.trim()]
              : [],
          );
        }
      } finally {
        if (modelsProfileRef.current === requestId) {
          setModelsLoading(false);
        }
      }
    },
    [activeProfileId, engine, profiles],
  );

  const onSelectProfile = async (id: string) => {
    if (!engine) return;
    setPicker(null);
    setBusy(true);
    setModelsLoading(true);
    setKnownModels([]);
    modelsProfileRef.current = id;
    try {
      await postProfiles({
        ...engine,
        body: { action: 'activate', profileId: id },
      });
      const store = await fetchProfiles(engine);
      setProfiles(store.profiles as ProfileRow[]);
      setActiveProfileId(store.activeProfileId);
      const profile =
        store.profiles.find((p) => p.id === store.activeProfileId) ??
        store.profiles.find((p) => p.id === id);
      if (!profile) {
        setKnownModels([]);
        return;
      }

      // Apply this profile's full provider (no leftover from the previous one).
      const baseUrl = profile.provider.baseUrl ?? '';
      const rawPreset = (profile.provider.preset ||
        profile.provider.type ||
        settings.provider.preset) as DesktopSettings['provider']['preset'];
      const preset =
        /ollama\.com/i.test(baseUrl) && rawPreset === 'ollama'
          ? 'ollama-cloud'
          : rawPreset;
      const model = normalizeDesktopProviderModel(
        profile.provider.model ?? '',
        baseUrl,
      );
      const next = mergeDesktopSettings({
        ...settings,
        provider: {
          ...settings.provider,
          type: (profile.provider.type ||
            settings.provider.type) as DesktopSettings['provider']['type'],
          preset,
          baseUrl,
          model,
          contextWindow: profile.provider.contextWindow ?? 0,
          maximumOutputTokens: profile.provider.maximumOutputTokens ?? 0,
        },
      });
      await onSaveSettings({ settings: next });

      // Engine may have restarted — use fresh credentials for model list.
      const bridge = getDesktopBridge();
      const fresh = bridge ? await bridge.getSnapshot() : null;
      const listEngine = fresh
        ? { baseUrl: fresh.engineBaseUrl, token: fresh.authToken }
        : engine;
      await refreshModelsForActiveProfile(profile as ProfileRow, listEngine);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setModelsLoading(false);
    } finally {
      setBusy(false);
    }
  };

  const onNewChat = async () => {
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

  const runResume = useCallback(
    async (body: Record<string, unknown>) => {
      if (!snapshot || busy) return;
      setBusy(true);
      setError(null);
      setSuspension(null);

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
        const {
          assistant,
          activity,
          suspension: nextSuspension,
          mutatedPaths,
          tokenUsage: nextUsage,
        } = await consumeStream(
          streamResume({
            baseUrl: snapshot.engineBaseUrl,
            mode,
            ...(snapshot.authToken ? { token: snapshot.authToken } : {}),
            body: {
              ...body,
              approvalPreset: approvalMode,
              ...(threadId ? { sessionId: threadId } : {}),
            },
          }),
          assistantId,
        );

        const mergedActivity = [...priorActivity, ...activity];
        const fileChanges = await resolveFileChanges(mutatedPaths);
        let finalAssistant = assistant.trim()
          ? priorText
            ? `${priorText}\n\n${assistant}`
            : assistant
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
        await persistMessages(withAssistant, threadId, nextUsage);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId ? { ...m, streaming: false } : m,
          ),
        );
        setTokenUsage((prev) => ({ ...prev, live: false }));
      } finally {
        setBusy(false);
      }
    },
    [
      approvalMode,
      busy,
      consumeStream,
      messages,
      mode,
      resolveFileChanges,
      scrollToBottom,
      snapshot,
      threadId,
    ],
  );

  const onSubmit = useCallback(async () => {
    const prompt = input.trim();
    if (!prompt || !snapshot || busy) return;
    if (needsModel) {
      setError('Select a model in Settings, then Save.');
      setView('settings');
      return;
    }
    setBusy(true);
    setError(null);
    setSuspension(null);
    setInput('');
    const userId = `u_${Date.now()}`;
    const assistantId = `a_${Date.now()}`;
    const nextMessages: ChatMessage[] = [
      ...messages,
      { id: userId, role: 'user', text: prompt, mode },
      {
        id: assistantId,
        role: 'assistant',
        text: '',
        mode,
        activity: [],
        streaming: true,
      },
    ];
    setMessages(nextMessages);
    requestAnimationFrame(() => scrollToBottom(true));
    try {
      let activeThread = threadId;
      if (!activeThread && engine) {
        const created = await postHistory({
          ...engine,
          body: { action: 'new', title: prompt.slice(0, 48) },
        });
        activeThread = created.activeThreadId;
        setThreadId(activeThread);
        setHistory(created.threads as HistoryThread[]);
      }

      const {
        assistant,
        activity,
        suspension: nextSuspension,
        mutatedPaths,
        tokenUsage: nextUsage,
      } = await consumeStream(
        streamPrompt({
          baseUrl: snapshot.engineBaseUrl,
          prompt,
          mode,
          model: snapshot.settings.provider.model,
          sessionId: activeThread,
          approvalPreset: approvalMode,
          thoroughness,
          pinnedPaths,
          requiredSkillIds: pinnedSkillIds,
          requiredMcpServerIds: pinnedMcpIds,
          ...(snapshot.authToken ? { token: snapshot.authToken } : {}),
        }),
        assistantId,
      );

      const fileChanges = await resolveFileChanges(mutatedPaths);

      let finalAssistant = assistant;
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
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantId ? { ...m, streaming: false } : m,
        ),
      );
      setTokenUsage((prev) => ({ ...prev, live: false }));
    } finally {
      setBusy(false);
    }
  }, [
    approvalMode,
    busy,
    consumeStream,
    engine,
    input,
    messages,
    mode,
    needsModel,
    pinnedMcpIds,
    pinnedPaths,
    pinnedSkillIds,
    resolveFileChanges,
    scrollToBottom,
    snapshot,
    thoroughness,
    threadId,
  ]);

  const onApproveSuspension = () => {
    if (!suspension) return;
    if (suspension.kind === 'plan_approval_required') {
      void runResume({
        runId: suspension.runId,
        planDecision: { decision: 'approved' },
      });
      return;
    }
    if (suspension.kind === 'grant_expansion_required') {
      const expansionId = suspension.grantExpansion?.expansionId;
      if (!expansionId) return;
      void runResume({
        runId: suspension.runId,
        grantExpansion: { expansionId, decision: 'approved' },
      });
      return;
    }
    const approvalId = suspension.approval?.approvalId;
    if (!approvalId) return;
    void runResume({
      runId: suspension.runId,
      approval: { approvalId, decision: 'approved' },
      approvalPreset: approvalMode,
    });
  };

  const onDenySuspension = () => {
    if (!suspension) return;
    if (suspension.kind === 'plan_approval_required') {
      void runResume({
        runId: suspension.runId,
        planDecision: { decision: 'rejected' },
      });
      return;
    }
    if (suspension.kind === 'grant_expansion_required') {
      const expansionId = suspension.grantExpansion?.expansionId;
      if (!expansionId) return;
      void runResume({
        runId: suspension.runId,
        grantExpansion: { expansionId, decision: 'denied' },
      });
      return;
    }
    const approvalId = suspension.approval?.approvalId;
    if (!approvalId) return;
    void runResume({
      runId: suspension.runId,
      approval: { approvalId, decision: 'denied' },
      approvalPreset: approvalMode,
    });
  };

  const onClarifySuspension = (answer: string) => {
    if (!suspension || !answer.trim()) return;
    void runResume({
      runId: suspension.runId,
      clarificationAnswer: answer,
    });
  };

  const onContinueSuspension = (guidance?: string) => {
    if (!suspension) return;
    void runResume({
      runId: suspension.runId,
      continueDecision: {
        decision: 'continue',
        ...(guidance ? { guidance } : {}),
      },
    });
  };

  const onStopSuspension = () => {
    if (!suspension) return;
    if (suspension.kind === 'clarification_required') {
      setSuspension(null);
      return;
    }
    if (
      suspension.kind === 'approval_required' ||
      (suspension.approval &&
        suspension.kind !== 'plan_approval_required' &&
        suspension.kind !== 'grant_expansion_required' &&
        suspension.kind !== 'continue_required')
    ) {
      onDenySuspension();
      return;
    }
    void runResume({
      runId: suspension.runId,
      continueDecision: { decision: 'stop' },
    });
  };

  const toggleSkillPin = (id: string) => {
    setPinnedSkillIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  };

  const toggleMcpPin = (id: string) => {
    setPinnedMcpIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  };

  const hasPins =
    pinnedPaths.length > 0 ||
    pinnedSkillIds.length > 0 ||
    pinnedMcpIds.length > 0;

  const setLayout = (next: ChatLayout) => {
    setChatLayout(next);
    setView('chat');
    try {
      localStorage.setItem('mitii.desktop.chatLayout', next);
    } catch {
      /* ignore */
    }
  };

  const inCodeMode = view === 'chat' && chatLayout === 'code';
  const showHistorySide = view === 'chat' && chatLayout === 'chat';
  const showActivityBar = inCodeMode || view === 'settings';
  const hideCodeChat =
    inCodeMode &&
    (workspaceSide === 'mcp' ||
      workspaceSide === 'skills' ||
      workspaceSide === 'recipes');

  const suggestMenu = pinMenu ? (
    <div
      className="composer-suggest"
      role="listbox"
      aria-label="Mention suggestions"
    >
      {suggestLoading && suggestItems.length === 0 ? (
        <button type="button" disabled>
          Searching…
        </button>
      ) : null}
      {!suggestLoading && suggestItems.length === 0 ? (
        <button type="button" disabled>
          {mention?.query
            ? `No matches for “${mention.query}”`
            : 'Type to filter files, skills, MCP'}
        </button>
      ) : null}
      {suggestItems.map((item, index) => {
        if (item.kind === 'file') {
          return (
            <button
              key={`file:${item.path}`}
              type="button"
              role="option"
              className={index === suggestIndex ? 'is-selected' : undefined}
              aria-selected={index === suggestIndex}
              onMouseEnter={() => setSuggestIndex(index)}
              onClick={() => applySuggestItem(item)}
            >
              <span className="composer-attach__item-icon" aria-hidden>
                ⌗
              </span>
              <span>
                {item.path}
                <small>File</small>
              </span>
            </button>
          );
        }
        if (item.kind === 'skill') {
          return (
            <button
              key={`skill:${item.id}`}
              type="button"
              role="option"
              className={
                index === suggestIndex || pinnedSkillIds.includes(item.id)
                  ? 'is-selected'
                  : undefined
              }
              aria-selected={index === suggestIndex}
              onMouseEnter={() => setSuggestIndex(index)}
              onClick={() => applySuggestItem(item)}
            >
              <span className="composer-attach__item-icon" aria-hidden>
                /
              </span>
              <span>
                {item.title || item.id}
                <small>
                  Skill
                  {item.description ? ` · ${item.description}` : ''}
                </small>
              </span>
            </button>
          );
        }
        return (
          <button
            key={`mcp:${item.id}`}
            type="button"
            role="option"
            className={
              index === suggestIndex || pinnedMcpIds.includes(item.id)
                ? 'is-selected'
                : undefined
            }
            aria-selected={index === suggestIndex}
            onMouseEnter={() => setSuggestIndex(index)}
            onClick={() => applySuggestItem(item)}
          >
            <span className="composer-attach__item-icon" aria-hidden>
              ⎈
            </span>
            <span>
              {item.name || item.id}
              <small>MCP · {item.enabled ? 'enabled' : 'disabled'}</small>
            </span>
          </button>
        );
      })}
    </div>
  ) : null;

  const chatPanel = (
    <div
      className={`chat-view${inCodeMode ? ' chat-view--code' : ''}`}
      style={{ '--composer-mode-color': accent } as CSSProperties}
    >
      {error ? <div className="alert">{error}</div> : null}

      <div className="feed" ref={feedRef}>
        {messages.length === 0 ? (
          <div className="hero">
            <h1>Mitii</h1>
            <p>Ask · Plan · Agent — local-first coding agent.</p>
          </div>
        ) : (
          messages.map((m) => (
            <div
              key={m.id}
              className={`turn turn--${m.role} turn--mode-${m.mode ?? 'ask'}`}
              style={
                m.role === 'assistant'
                  ? ({
                      '--turn-accent': modeAccent(
                        (m.mode as DesktopAgentMode) || 'ask',
                      ),
                    } as CSSProperties)
                  : undefined
              }
            >
              <div className="turn__role">
                {m.role === 'user' ? 'You' : 'Mitii'}
              </div>
              {m.role === 'assistant' ? (
                <>
                  <ActivityTimeline
                    items={(m.activity ?? []).filter(
                      (item) => item.kind !== 'mcp_app',
                    )}
                    streaming={Boolean(m.streaming)}
                  />
                  {mcpAppsFromActivity(m.activity).map((app, index) => (
                    <McpAppCard
                      key={`${app.title}-${app.paths.svg ?? app.paths.md ?? index}`}
                      app={app}
                      onOpenPath={(path) => {
                        setLayout('code');
                        setWorkspaceSide('explorer');
                        setOpenPathRequest({ path, view: 'file' });
                      }}
                    />
                  ))}
                  {m.fileChanges && m.fileChanges.files.length > 0 ? (
                    <FileChangesCard
                      changes={m.fileChanges}
                      onOpenFile={(path) => {
                        setLayout('code');
                        setWorkspaceSide('git');
                        setOpenPathRequest({ path, view: 'diff' });
                        setPinnedPaths((prev) =>
                          prev.includes(path)
                            ? prev
                            : [...prev, path].slice(0, 32),
                        );
                      }}
                    />
                  ) : null}
                  {m.text ? <MarkdownBody text={m.text} /> : null}
                </>
              ) : (
                <div className="turn__user">{m.text}</div>
              )}
            </div>
          ))
        )}
        <div ref={feedEndRef} className="feed-end" aria-hidden />
      </div>

      {suspension ? (
        <ApprovalCard
          suspension={suspension}
          busy={busy}
          onApprove={onApproveSuspension}
          onDeny={onDenySuspension}
          onClarify={onClarifySuspension}
          onContinue={onContinueSuspension}
          onStop={onStopSuspension}
        />
      ) : null}

      <div className="composer-dock">
        <form
          className="composer-box"
          ref={pinMenuRef}
          style={{ '--composer-mode-color': accent } as CSSProperties}
          onSubmit={(e) => {
            e.preventDefault();
            void onSubmit();
          }}
        >
          {suggestMenu}
          {hasPins ? (
            <div className="composer-pins">
              {pinnedPaths.map((path) => (
                <span key={`path:${path}`} className="pin-chip">
                  {shortPath(path)}
                  <button
                    type="button"
                    aria-label={`Unpin ${path}`}
                    disabled={busy}
                    onClick={() =>
                      setPinnedPaths((prev) => prev.filter((p) => p !== path))
                    }
                  >
                    ×
                  </button>
                </span>
              ))}
              {pinnedSkillIds.map((id) => (
                <span key={`skill:${id}`} className="pin-chip">
                  {`@skill:${id}`}
                  <button
                    type="button"
                    aria-label={`Unpin skill ${id}`}
                    disabled={busy}
                    onClick={() => toggleSkillPin(id)}
                  >
                    ×
                  </button>
                </span>
              ))}
              {pinnedMcpIds.map((id) => (
                <span key={`mcp:${id}`} className="pin-chip">
                  {`@mcp:${id}`}
                  <button
                    type="button"
                    aria-label={`Unpin MCP ${id}`}
                    disabled={busy}
                    onClick={() => toggleMcpPin(id)}
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          ) : null}
          <textarea
            ref={textareaRef}
            value={input}
            disabled={busy || !snapshot}
            placeholder="Message Mitii…  @ to attach files, skills, MCP"
            rows={1}
            onChange={(e) => {
              const next = e.target.value;
              setInput(next);
              updateMentionFromInput(next);
            }}
            onKeyDown={(e) => {
              if (pinMenu && suggestItems.length > 0) {
                if (e.key === 'ArrowDown') {
                  e.preventDefault();
                  setSuggestIndex((i) => (i + 1) % suggestItems.length);
                  return;
                }
                if (e.key === 'ArrowUp') {
                  e.preventDefault();
                  setSuggestIndex(
                    (i) => (i - 1 + suggestItems.length) % suggestItems.length,
                  );
                  return;
                }
                if (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey)) {
                  const item = suggestItems[suggestIndex];
                  if (item) {
                    e.preventDefault();
                    applySuggestItem(item);
                    return;
                  }
                }
              }
              if (e.key === 'Escape' && pinMenu) {
                e.preventDefault();
                closeSuggest();
                return;
              }
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void onSubmit();
              }
            }}
          />
          <div className="composer-footer">
            <div className="composer-controls-row">
              <div className="composer-attach">
                <button
                  type="button"
                  className={`composer-attach__symbol${
                    pinMenu ? ' is-open' : ''
                  }`}
                  disabled={busy || !snapshot}
                  aria-label="Attach context, skills, or MCP"
                  aria-haspopup="listbox"
                  aria-expanded={pinMenu}
                  title="@ Attach"
                  onClick={() => openAtSuggest()}
                >
                  @
                </button>
              </div>
              <ComposerControls
                mode={mode}
                approvalMode={approvalMode}
                thoroughness={thoroughness}
                disabled={busy}
                onModeChange={onModeChange}
                onApprovalModeChange={setApprovalMode}
                onThoroughnessChange={setThoroughness}
              />
              <div className="composer-actions">
                <button
                  type="submit"
                  className="composer-send"
                  style={
                    {
                      '--composer-control-color': accent,
                    } as CSSProperties
                  }
                  disabled={busy || !input.trim()}
                  title="Send"
                  aria-label="Send"
                >
                  {busy ? (
                    <span className="composer-send__busy" aria-hidden>
                      …
                    </span>
                  ) : (
                    <svg
                      className="composer-send__icon"
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.4"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden
                    >
                      <path d="M12 19V5" />
                      <path d="m5 12 7-7 7 7" />
                    </svg>
                  )}
                </button>
              </div>
            </div>
            <div className="composer-meta-row">
              <TokenMeter usage={tokenUsage} />
              <ModelQuickSelect
                model={modelLabel}
                models={knownModels}
                loading={modelsLoading}
                disabled={busy}
                onChange={(next) => void onSelectModel(next)}
                onOpen={() => {
                  void refreshModelsForActiveProfile();
                }}
                onEditProfile={() => {
                  setSettingsTab('profiles');
                  setView('settings');
                }}
              />
            </div>
          </div>
        </form>
      </div>
    </div>
  );

  return (
    <div className={`app${inCodeMode ? ' app--code' : ''}`}>
      <header className="app-topbar">
        <div className="app-topbar__left">
          <div className="layout-toggle" role="group" aria-label="Layout">
            <button
              type="button"
              className={
                view === 'chat' && chatLayout === 'chat' ? 'is-active' : undefined
              }
              onClick={() => setLayout('chat')}
            >
              Chat
            </button>
            <button
              type="button"
              className={inCodeMode ? 'is-active' : undefined}
              onClick={() => setLayout('code')}
            >
              Code
            </button>
          </div>
        </div>
        <div className="app-topbar__right">
          <IndexStatusChip
            index={indexStatus}
            indexing={indexIndexing}
            progressPercent={indexProgress}
            streamLines={indexStream}
            workspaceLabel={workspaceLabel(snapshot?.workspaceRoot ?? '')}
            onReindex={() => void runReindex()}
            onOpenSettings={() => {
              setSettingsTab('features');
              setView('settings');
            }}
          />
          <div className="status-icons status-icons--identity">
          <div className="top-select">
            <button
              type="button"
              className="top-select__trigger"
              disabled={busy}
              aria-expanded={picker === 'profile'}
              onClick={() =>
                setPicker((v) => (v === 'profile' ? null : 'profile'))
              }
            >
              <IconUser size={14} />
              <span className="top-select__label">Profile</span>
              <span className="top-select__value">
                {activeProfile?.name ?? 'Default'}
              </span>
              <span aria-hidden>▾</span>
            </button>
          </div>
          <div className="top-workspace-cluster">
            <div className="top-select">
              <button
                type="button"
                className="top-select__trigger top-select__trigger--repo"
                disabled={busy}
                aria-expanded={picker === 'workspace'}
                title={snapshot?.workspaceRoot ?? 'Workspace'}
                onClick={() =>
                  setPicker((v) => (v === 'workspace' ? null : 'workspace'))
                }
              >
                <IconWorkspace size={14} />
                <span className="top-select__label">Workspace</span>
                <span className="top-select__value">
                  {workspaceLabel(snapshot?.workspaceRoot ?? '') ||
                    'Select folder'}
                </span>
                <span aria-hidden>▾</span>
              </button>
            </div>
            <button
              type="button"
              className="top-icon-btn"
              disabled={busy}
              title="Switch workspace"
              aria-label="Switch workspace"
              onClick={() => setPicker('workspace')}
            >
              <IconSwitch size={15} />
              <span>Switch</span>
            </button>
            <button
              type="button"
              className="top-icon-btn top-icon-btn--accent"
              disabled={busy}
              title="Add workspace"
              aria-label="Add workspace"
              onClick={() => void onPickWorkspace()}
            >
              <IconPlus size={15} />
              <span>New</span>
            </button>
          </div>
          </div>
        </div>
      </header>

      <div className="app-body">
      {showHistorySide ? (
        <>
          <aside className="side" style={{ width: sideWidth, flex: '0 0 auto' }}>
            <div className="side-brand">
              <img src={logoUrl} alt="Mitii" />
            </div>
            <ChatHistoryNav
              workspaceRoot={snapshot?.workspaceRoot}
              threads={history.map((t) => ({
                id: t.id,
                title: t.title,
                updatedAt: t.updatedAt,
              }))}
              activeThreadId={threadId}
              busy={busy}
              loading={historyLoading}
              onOpenThread={(id) => void onOpenThread(id)}
              onDeleteThread={(id) => void onDeleteThread(id)}
              onNewChat={() => void onNewChat()}
              onSwitchWorkspace={() => setPicker('workspace')}
            />
            <div className="side-foot">
              <button type="button" onClick={() => setView('settings')}>
                Settings
              </button>
            </div>
          </aside>
          <ResizeHandle
            value={sideWidth}
            onChange={setSideWidth}
            min={160}
            max={420}
            label="Resize chat list"
          />
        </>
      ) : null}

      {showActivityBar ? (
        <aside
          className={`activity-bar${view === 'settings' ? ' activity-bar--settings' : ''}`}
          aria-label={view === 'settings' ? 'Settings' : 'Activity bar'}
        >
          <div className="activity-bar__brand">
            <img src={logoUrl} alt="Mitii" />
          </div>
          {view !== 'settings' ? (
            <ActivityBarButton
              className="activity-bar__new"
              label="New chat"
              disabled={busy}
              onClick={() => void onNewChat()}
            >
              <IconPlus size={20} />
            </ActivityBarButton>
          ) : null}
          <nav
            className="activity-bar__nav"
            aria-label={view === 'settings' ? 'Settings sections' : 'Views'}
          >
            {view === 'settings'
              ? SETTINGS_TABS.map(({ id, label }) => {
                  const Icon = SETTINGS_TAB_ICONS[id];
                  return (
                    <ActivityBarButton
                      key={id}
                      label={label}
                      active={settingsTab === id}
                      aria-current={settingsTab === id ? 'page' : undefined}
                      onClick={() => setSettingsTab(id)}
                    >
                      <Icon size={22} />
                    </ActivityBarButton>
                  );
                })
              : null}
            {inCodeMode ? (
              <>
                <ActivityBarButton
                  label="Explorer"
                  active={workspaceSide === 'explorer'}
                  onClick={() => setWorkspaceSide('explorer')}
                >
                  <IconFiles size={22} />
                </ActivityBarButton>
                <ActivityBarButton
                  label="Source Control"
                  active={workspaceSide === 'git'}
                  onClick={() => setWorkspaceSide('git')}
                  badge={
                    gitBadge > 0 ? (
                      <em className="activity-badge">{gitBadge}</em>
                    ) : null
                  }
                >
                  <IconGit size={22} />
                </ActivityBarButton>
                <ActivityBarButton
                  label="MCP"
                  active={workspaceSide === 'mcp'}
                  onClick={() => setWorkspaceSide('mcp')}
                >
                  <IconMcp size={22} />
                </ActivityBarButton>
                <ActivityBarButton
                  label="Skills"
                  active={workspaceSide === 'skills'}
                  onClick={() => setWorkspaceSide('skills')}
                >
                  <IconSkills size={22} />
                </ActivityBarButton>
                <ActivityBarButton
                  label="Recipes"
                  active={workspaceSide === 'recipes'}
                  onClick={() => setWorkspaceSide('recipes')}
                >
                  <IconRecipes size={22} />
                </ActivityBarButton>
              </>
            ) : null}
          </nav>
          <div className="activity-bar__foot">
            <ActivityBarButton
              label="Chat mode"
              active={view === 'chat' && chatLayout === 'chat'}
              onClick={() => setLayout('chat')}
            >
              <IconChat size={22} />
            </ActivityBarButton>
            <ActivityBarButton
              label="Code mode"
              active={inCodeMode}
              onClick={() => setLayout('code')}
            >
              <IconCode size={22} />
            </ActivityBarButton>
            <ActivityBarButton
              label="Settings"
              active={view === 'settings'}
              onClick={() => setView('settings')}
            >
              <IconSettings size={22} />
            </ActivityBarButton>
          </div>
        </aside>
      ) : null}

      <section className="main">
        {view === 'settings' ? (
          <SettingsPanel
            key={snapshot?.workspaceRoot ?? 'settings'}
            settings={settings}
            workspaceRoot={snapshot?.workspaceRoot ?? ''}
            hasApiKey={snapshot?.hasApiKey ?? false}
            hasSearchApiKey={snapshot?.hasSearchApiKey ?? false}
            busy={busy}
            engineBaseUrl={snapshot?.engineBaseUrl}
            authToken={snapshot?.authToken}
            tab={settingsTab}
            onTabChange={setSettingsTab}
            hideSideNav
            onSave={onSaveSettings}
            onPickWorkspace={() => void onPickWorkspace()}
            onIndexStarted={() => {
              setIndexIndexing(true);
              setIndexProgress(8);
              setIndexStream([]);
              pushIndexStream('Reindex started from settings…');
            }}
            onIndexChanged={() => {
              pushIndexStream('Index status updated');
              void refreshIndexStatus();
            }}
            onWorkspaceCacheCleared={() => {
              void refresh();
            }}
          />
        ) : inCodeMode ? (
          <div
            className={`code-mode${
              hideCodeChat ? ' code-mode--extensions' : ''
            }`}
          >
            <div className="code-mode__workspace">
              {engine ? (
                <WorkspacePanel
                  key={snapshot?.workspaceRoot ?? 'workspace'}
                  baseUrl={engine.baseUrl}
                  token={engine.token}
                  workspaceRoot={snapshot?.workspaceRoot ?? ''}
                  embedded
                  hideActivityRail
                  side={workspaceSide}
                  onSideChange={setWorkspaceSide}
                  onGitCountChange={setGitBadge}
                  openPathRequest={openPathRequest}
                  onOpenPathHandled={() => setOpenPathRequest(null)}
                  onUsePrompt={(prompt, nextMode) => {
                    setInput(prompt);
                    if (nextMode) setMode(nextMode);
                    setView('chat');
                    setLayout('code');
                    setWorkspaceSide('explorer');
                  }}
                  onRestartEngine={async () => {
                    const bridge = getDesktopBridge();
                    if (!bridge) return;
                    await bridge.restartEngine();
                    await refresh();
                  }}
                  activeProfileName={activeProfile?.name ?? null}
                  hasActiveProfile={Boolean(activeProfileId && activeProfile)}
                  onOpenProfiles={() => {
                    setView('settings');
                    setSettingsTab('profiles');
                  }}
                />
              ) : (
                <div className="workspace-hero">
                  <h2>Repository</h2>
                  <p>Engine is starting…</p>
                </div>
              )}
            </div>
            {hideCodeChat ? null : (
              <>
                <ResizeHandle
                  value={codeChatWidth}
                  onChange={setCodeChatWidth}
                  min={280}
                  max={720}
                  reverse
                  label="Resize chat panel"
                />
                <div
                  className="code-mode__chat"
                  style={{ width: codeChatWidth, flex: '0 0 auto' }}
                >
                  {chatPanel}
                </div>
              </>
            )}
          </div>
        ) : (
          chatPanel
        )}
      </section>
      </div>

      {picker ? (
        <div
          className="identity-picker-overlay"
          role="dialog"
          aria-modal="true"
          onClick={() => setPicker(null)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') setPicker(null);
          }}
        >
          <div
            className="identity-picker-shell"
            onClick={(e) => e.stopPropagation()}
          >
            {picker === 'profile' ? (
              <IdentityPicker
                title="Who's coding?"
                subtitle="Profiles own provider, modes, and budget."
                cards={profiles.map((profile) => ({
                  id: profile.id,
                  title: profile.name,
                  subtitle: profile.provider.model || profile.provider.preset,
                  active: profile.id === activeProfileId,
                }))}
                onSelect={(id) => void onSelectProfile(id)}
                onAdd={() => {
                  setPicker(null);
                  setSettingsTab('profiles');
                  setView('settings');
                }}
                addLabel="Manage profiles"
                footer={
                  <button
                    type="button"
                    className="btn btn-ghost"
                    onClick={() => setPicker(null)}
                  >
                    Cancel
                  </button>
                }
              />
            ) : (
              <IdentityPicker
                title="Choose a workspace"
                subtitle="Only the selected workspace is active. Remove hides it from Mitii — .mitii data stays on disk."
                cards={(snapshot?.recentWorkspaces ?? []).map((path) => ({
                  id: path,
                  title: workspaceLabel(path),
                  subtitle: shortPath(path),
                  active: path === snapshot?.workspaceRoot,
                }))}
                onSelect={(id) => void onSwitchWorkspace(id)}
                onAdd={() => void onPickWorkspace()}
                addLabel="Add workspace"
                onRemove={(id) => void onForgetWorkspace(id)}
                removeLabel="Remove"
                footer={
                  <button
                    type="button"
                    className="btn btn-ghost"
                    onClick={() => setPicker(null)}
                  >
                    Cancel
                  </button>
                }
              />
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
