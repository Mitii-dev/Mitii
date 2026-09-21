import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';

import {
  appendActivity,
  runEventToActivity,
  type DesktopActivityItem,
} from '../shared/activity.js';
import type { DesktopShellSnapshot } from '../shared/bridge.js';
import type {
  DesktopAgentMode,
  DesktopPromptStreamLine,
} from '../shared/protocol.js';
import {
  DEFAULT_DESKTOP_SETTINGS,
  SETTINGS_TABS,
  mergeDesktopSettings,
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
  IconAutocomplete,
  IconChat,
  IconCode,
  IconContext,
  IconDeveloper,
  IconFeatures,
  IconFiles,
  IconGit,
  IconMcp,
  IconModes,
  IconPlus,
  IconProvider,
  IconRecipes,
  IconSettings,
  IconSkills,
  IconWorkspace,
} from './ActivityIcons.js';
import { ActivityTimeline } from './ActivityTimeline.js';
import {
  extractAssistantText,
  fetchFileChanges,
  fetchHistory,
  fetchIndexStatus,
  fetchMcpServers,
  fetchProfiles,
  fetchSkills,
  finalizeAssistantText,
  getDesktopBridge,
  postHistory,
  postProfiles,
  searchWorkspacePaths,
  shortPath,
  streamPrompt,
  streamResume,
} from './api.js';
import { FileChangesCard } from './FileChangesCard.js';
import { ApprovalCard } from './ApprovalCard.js';
import {
  ComposerControls,
  modeAccent,
  type ApprovalUiMode,
  type ThoroughnessUi,
} from './ComposerControls.js';
import { MarkdownBody } from './MarkdownBody.js';
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
}

interface ProfileRow {
  id: string;
  name: string;
  provider: { model: string; preset?: string };
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
  model: IconProvider,
  autocomplete: IconAutocomplete,
  workspace: IconWorkspace,
  modes: IconModes,
  context: IconContext,
  features: IconFeatures,
  integrations: IconMcp,
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
  const [settingsTab, setSettingsTab] = useState<SettingsTabId>('model');
  const [gitBadge, setGitBadge] = useState(0);
  const [snapshot, setSnapshot] = useState<DesktopShellSnapshot | null>(null);
  const [mode, setMode] = useState<DesktopAgentMode>('ask');
  const [approvalMode, setApprovalMode] = useState<ApprovalUiMode>('guided');
  const [thoroughness, setThoroughness] = useState<ThoroughnessUi>('medium');
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [threadId, setThreadId] = useState<string | undefined>();
  const [history, setHistory] = useState<HistoryThread[]>([]);
  const [indexHint, setIndexHint] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tokenUsage, setTokenUsage] = useState<TokenUsageState>(emptyTokenUsage);
  const [profiles, setProfiles] = useState<ProfileRow[]>([]);
  const [activeProfileId, setActiveProfileId] = useState('');
  const [profileOpen, setProfileOpen] = useState(false);
  const [repoOpen, setRepoOpen] = useState(false);
  const [knownModels, setKnownModels] = useState<string[]>([]);
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
  const profileRef = useRef<HTMLDivElement>(null);
  const repoRef = useRef<HTMLDivElement>(null);
  const pinMenuRef = useRef<HTMLFormElement>(null);
  const searchReq = useRef(0);

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
    if (!profileOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!profileRef.current?.contains(event.target as Node)) {
        setProfileOpen(false);
      }
    };
    window.addEventListener('pointerdown', onPointerDown);
    return () => window.removeEventListener('pointerdown', onPointerDown);
  }, [profileOpen]);

  useEffect(() => {
    if (!repoOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!repoRef.current?.contains(event.target as Node)) {
        setRepoOpen(false);
      }
    };
    window.addEventListener('pointerdown', onPointerDown);
    return () => window.removeEventListener('pointerdown', onPointerDown);
  }, [repoOpen]);

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
    void fetchHistory(engine)
      .then((store) => {
        if (cancelled) return;
        const threads = store.threads as HistoryThread[];
        setHistory((prev) =>
          threads.length > 0 || prev.length === 0 ? threads : prev,
        );
        // Restore the active conversation on first load / workspace switch.
        setThreadId((current) => {
          if (current) return current;
          return store.activeThreadId ?? threads[0]?.id;
        });
        setMessages((current) => {
          if (current.length > 0) return current;
          const activeId = store.activeThreadId ?? threads[0]?.id;
          if (!activeId) return current;
          const active = threads.find((t) => t.id === activeId);
          return active ? (active.messages as ChatMessage[]) : current;
        });
      })
      .catch(() => undefined);
    void fetchIndexStatus(engine)
      .then((s) => {
        if (cancelled) return;
        setIndexHint(s.indexed ? `${s.fileCount} indexed` : 'not indexed');
      })
      .catch(() => undefined);
    void fetchProfiles(engine)
      .then((store) => {
        if (cancelled) return;
        setProfiles(store.profiles as ProfileRow[]);
        setActiveProfileId(store.activeProfileId);
        const models = store.profiles
          .map((p) => p.provider.model)
          .filter(Boolean);
        setKnownModels((prev) => Array.from(new Set([...prev, ...models])));
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

  const persistMessages = async (
    nextMessages: ChatMessage[],
    activeId?: string,
  ) => {
    if (!engine) return;
    const store = await postHistory({
      ...engine,
      body: {
        action: 'save',
        threadId: activeId ?? threadId,
        messages: nextMessages.map(({ streaming: _s, ...rest }) => rest),
        title: nextMessages.find((m) => m.role === 'user')?.text.slice(0, 48),
      },
    });
    setHistory(store.threads as HistoryThread[]);
    if (store.activeThreadId) setThreadId(store.activeThreadId);
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
    }> => {
      let assistant = '';
      let activity: DesktopActivityItem[] = [];
      let nextSuspension: DesktopSuspension | null = null;
      const mutated = new Set<string>();

      for await (const line of lines) {
        if (line.op === 'error') {
          throw new Error(line.message ?? line.error);
        }
        if (line.op === 'event') {
          const tokens = extractTurnTokens(line.event);
          if (tokens) {
            setTokenUsage((prev) =>
              addTurnTokens({ ...prev, live: true }, tokens.in, tokens.out),
            );
          }
          const breakdown = breakdownFromPromptReady(line.event);
          if (breakdown) {
            setTokenUsage((prev) => ({
              ...prev,
              contextBreakdown: breakdown,
              contextWindow: breakdown.contextWindow || prev.contextWindow,
              live: true,
            }));
          }
          if (isToolCompleted(line.event)) {
            setTokenUsage((prev) => ({
              ...prev,
              toolCalls: prev.toolCalls + 1,
            }));
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
          setTokenUsage((prev) => ({ ...prev, live: false }));
        }
      }

      return {
        assistant,
        activity,
        suspension: nextSuspension,
        mutatedPaths: [...mutated],
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
    setTokenUsage(emptyTokenUsage());
    setSuspension(null);
    setPinnedPaths([]);
    setPinnedSkillIds([]);
    setPinnedMcpIds([]);
  };

  const onPickWorkspace = async () => {
    const bridge = getDesktopBridge();
    if (!bridge) return;
    setBusy(true);
    setRepoOpen(false);
    try {
      await bridge.pickWorkspace();
      await refresh();
      resetChatForWorkspaceSwitch();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const onSwitchWorkspace = async (workspaceRoot: string) => {
    const bridge = getDesktopBridge();
    if (!bridge) return;
    if (workspaceRoot === snapshot?.workspaceRoot) {
      setRepoOpen(false);
      return;
    }
    setBusy(true);
    setRepoOpen(false);
    try {
      const result = await bridge.setWorkspace(workspaceRoot);
      if (!result.ok) {
        setError(result.reason ?? 'Failed to switch repository');
        return;
      }
      await refresh();
      resetChatForWorkspaceSwitch();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
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
      if (engine) {
        await postProfiles({
          ...engine,
          body: {
            action: 'upsert',
            name: 'Default',
            provider: inputSave.settings.provider,
            hasSecret: Boolean(inputSave.apiKey) || snapshot?.hasApiKey,
            apiKey: inputSave.apiKey,
          },
        }).catch(() => undefined);
      }
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  const onSelectModel = async (model: string) => {
    if (!snapshot || !model.trim()) return;
    const next = mergeDesktopSettings({
      ...settings,
      provider: { ...settings.provider, model },
    });
    await onSaveSettings({ settings: next });
    setKnownModels((prev) =>
      prev.includes(model) ? prev : [model, ...prev],
    );
  };

  const onSelectProfile = async (id: string) => {
    if (!engine) return;
    setProfileOpen(false);
    setBusy(true);
    try {
      await postProfiles({
        ...engine,
        body: { action: 'activate', profileId: id },
      });
      const store = await fetchProfiles(engine);
      setProfiles(store.profiles as ProfileRow[]);
      setActiveProfileId(store.activeProfileId);
      const profile = store.profiles.find((p) => p.id === store.activeProfileId);
      if (profile?.provider.model) {
        await onSelectModel(profile.provider.model);
      } else {
        await refresh();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const onNewChat = async () => {
    setSuspension(null);
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
    const store = await postHistory({
      ...engine,
      body: { action: 'activate', threadId: id },
    });
    setHistory(store.threads as HistoryThread[]);
    setThreadId(id);
    setMessages(
      (store.threads.find((t) => t.id === id)?.messages ??
        []) as ChatMessage[],
    );
    setTokenUsage(emptyTokenUsage());
    setView('chat');
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
        } = await consumeStream(
          streamResume({
            baseUrl: snapshot.engineBaseUrl,
            mode,
            ...(snapshot.authToken ? { token: snapshot.authToken } : {}),
            body: {
              ...body,
              approvalPreset: approvalMode,
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
        await persistMessages(withAssistant, threadId);
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
      } = await consumeStream(
        streamPrompt({
          baseUrl: snapshot.engineBaseUrl,
          prompt,
          mode,
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
      <header className="chat-topbar">
        <div className="chat-topbar__left">
          <span className="chat-topbar__title">Mitii</span>
          <span className="chat-topbar__mode" style={{ color: accent }}>
            {mode === 'ask' ? 'Ask' : mode === 'plan' ? 'Plan' : 'Agent'}
          </span>
          <div className="layout-toggle" role="group" aria-label="Chat layout">
            <button
              type="button"
              className={chatLayout === 'chat' ? 'is-active' : undefined}
              onClick={() => setLayout('chat')}
            >
              Chat
            </button>
            <button
              type="button"
              className={chatLayout === 'code' ? 'is-active' : undefined}
              onClick={() => setLayout('code')}
            >
              Code
            </button>
          </div>
        </div>
        <div className="chat-topbar__right">
          <div className="top-select" ref={profileRef}>
            <button
              type="button"
              className="top-select__trigger"
              disabled={busy}
              aria-expanded={profileOpen}
              onClick={() => setProfileOpen((v) => !v)}
            >
              <span className="top-select__label">Profile</span>
              <span className="top-select__value">
                {activeProfile?.name ?? 'Default'}
              </span>
              <span aria-hidden>▾</span>
            </button>
            {profileOpen ? (
              <div className="top-select__menu" role="listbox">
                {profiles.length === 0 ? (
                  <div className="top-select__empty">No profiles yet</div>
                ) : (
                  profiles.map((profile) => (
                    <button
                      key={profile.id}
                      type="button"
                      role="option"
                      aria-selected={profile.id === activeProfileId}
                      className={
                        profile.id === activeProfileId
                          ? 'is-selected'
                          : undefined
                      }
                      onClick={() => void onSelectProfile(profile.id)}
                    >
                      {profile.name}
                    </button>
                  ))
                )}
              </div>
            ) : null}
          </div>
          <div className="top-select" ref={repoRef}>
            <button
              type="button"
              className="top-select__trigger top-select__trigger--repo"
              disabled={busy}
              aria-expanded={repoOpen}
              title={snapshot?.workspaceRoot ?? 'Workspace'}
              onClick={() => {
                setProfileOpen(false);
                setRepoOpen((v) => !v);
              }}
            >
              <span className="top-select__label">Repo</span>
              <span className="top-select__value">
                {shortPath(snapshot?.workspaceRoot ?? 'Select folder')}
              </span>
              <span aria-hidden>▾</span>
            </button>
            {repoOpen ? (
              <div className="top-select__menu top-select__menu--repo" role="listbox">
                {(snapshot?.recentWorkspaces ?? []).length === 0 ? (
                  <div className="top-select__empty">No repositories yet</div>
                ) : (
                  (snapshot?.recentWorkspaces ?? []).map((path) => (
                    <button
                      key={path}
                      type="button"
                      role="option"
                      aria-selected={path === snapshot?.workspaceRoot}
                      className={
                        path === snapshot?.workspaceRoot ? 'is-selected' : undefined
                      }
                      title={path}
                      onClick={() => void onSwitchWorkspace(path)}
                    >
                      {shortPath(path)}
                    </button>
                  ))
                )}
                <button
                  type="button"
                  className="top-select__menu-action"
                  onClick={() => void onPickWorkspace()}
                >
                  Add repository…
                </button>
              </div>
            ) : null}
          </div>
        </div>
      </header>

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
                    items={m.activity ?? []}
                    streaming={Boolean(m.streaming)}
                  />
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
                onModeChange={setMode}
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
                disabled={busy}
                onChange={(next) => void onSelectModel(next)}
              />
            </div>
          </div>
        </form>
      </div>
    </div>
  );

  return (
    <div className={`app${inCodeMode ? ' app--code' : ''}`}>
      {showHistorySide ? (
        <>
          <aside className="side" style={{ width: sideWidth, flex: '0 0 auto' }}>
            <div className="side-brand">
              <img src={logoUrl} alt="Mitii" />
            </div>
            <button
              type="button"
              className="side-new"
              disabled={busy}
              onClick={() => void onNewChat()}
            >
              New chat
            </button>
            <nav className="side-list">
              {history.map((thread) => (
                <button
                  key={thread.id}
                  type="button"
                  className={thread.id === threadId ? 'active' : undefined}
                  onClick={() => void onOpenThread(thread.id)}
                >
                  {thread.title || 'Chat'}
                </button>
              ))}
            </nav>
            <div className="side-foot">
              <span className="side-index">{indexHint || '—'}</span>
              <button
                type="button"
                className="active"
                onClick={() => setLayout('chat')}
              >
                Chat
              </button>
              <button
                type="button"
                onClick={() => setLayout('code')}
              >
                Code
              </button>
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
            onIndexChanged={() => {
              if (!engine) return;
              void fetchIndexStatus(engine).then((s) =>
                setIndexHint(
                  s.indexed ? `${s.fileCount} indexed` : 'not indexed',
                ),
              );
            }}
          />
        ) : inCodeMode ? (
          <div className="code-mode">
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
                  }}
                  onRestartEngine={async () => {
                    const bridge = getDesktopBridge();
                    if (!bridge) return;
                    await bridge.restartEngine();
                    await refresh();
                  }}
                />
              ) : (
                <div className="workspace-hero">
                  <h2>Repository</h2>
                  <p>Engine is starting…</p>
                </div>
              )}
            </div>
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
          </div>
        ) : (
          chatPanel
        )}
      </section>
    </div>
  );
}
