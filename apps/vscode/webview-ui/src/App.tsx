import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from 'react';

import { onHostMessage, postToHost } from './bridge';
import { ContextPanel, type ContextPin } from './components/ContextPanel';
import { ErrorBanner } from './components/ErrorBanner';
import { HistoryPanel } from './components/HistoryPanel';
import { IconButton } from './components/IconButton';
import {
  IconChat,
  IconCheck,
  IconCopy,
  IconHistory,
  IconModel,
  IconPlus,
  IconSend,
  IconSettings,
  IconSkills,
  IconStop,
} from './components/Icons';
import { IndexingStatusBar } from './components/IndexingStatusBar';
import type { ChatTurn } from './components/MessageList';
import { MessageList } from './components/MessageList';
import {
  ComposerControls,
  type ApprovalUiMode,
} from './components/ComposerControls';
import { OnboardingPanel } from './components/OnboardingPanel';
import { PendingPlanBanner } from './components/PendingPlanBanner';
import { PlanFollowStrip } from './components/PlanPanel';
import { ReviewPanel } from './components/ReviewPanel';
import { SettingsPanel } from './components/SettingsPanel';
import { SkillManagementPanel } from './components/skills/SkillManagementPanel';
import { WorkspaceBanner } from './components/WorkspaceBanner';
import { getProviderPreset } from './providerOptions';
import type {
  AgentUiDepth,
  AgentUiMode,
  ChatThreadSummary,
  CheckpointItemView,
  ContextToggles,
  HostToWebviewMessage,
  IndexStatusSnapshot,
  McpRuntimeStatus,
  McpServerConfig,
  McpSettings,
  MemoryItemView,
  PathSuggestion,
  PlanView,
  ProviderSettingsSnapshot,
  ReviewDiffView,
  RunFileChangesView,
  SettingsTab,
  SkillCatalogItem,
  TokenUsageSnapshot,
  UiSettingsPatch,
  UiNav,
  UiSettingsSnapshot,
  WorkspaceNoticeView,
  WorkspaceSnapshotInfo,
} from './protocol';
import { modeColor } from './modeColors';
import { TokenMeter } from './TokenMeter';
import { resolveDisplayedAssistantText } from './assistantDisplay';
import type { ChatMessageView } from './protocol';

const EMPTY_TOKEN_USAGE: TokenUsageSnapshot = {
  sessionTotal: 0,
  inputTokensTotal: 0,
  outputTokensTotal: 0,
  currentTurnTotal: 0,
  currentTurnInputTokens: 0,
  currentTurnOutputTokens: 0,
  aiCallCount: 0,
  modelCalls: 0,
  toolCalls: 0,
  loopIterations: 0,
  lastPromptTokens: 0,
  lastResponseTokens: 0,
  turnCount: 0,
  contextWindow: 32768,
  estimated: true,
  turns: [],
  live: false,
};

const DEFAULT_CONTEXT_TOGGLES: ContextToggles = {
  repoMap: true,
  diagnostics: true,
  gitDiff: true,
  editor: true,
  openTabs: false,
  memory: true,
};

const DEFAULT_RUN_BUDGET = {
  unlimited: false,
  maxModelCalls: 64,
  maxToolCalls: 128,
  maxLoopIterations: 96,
  maxWallTimeMinutes: 30,
};

const DEFAULT_UI: UiSettingsSnapshot = {
  showReasoning: true,
  reasoningPreviewMaxChars: 8000,
  depth: 'auto',
  contextToggles: DEFAULT_CONTEXT_TOGGLES,
  approvalMode: 'guided',
  runBudget: DEFAULT_RUN_BUDGET,
};

function shouldReplaceActivity(
  existing: { kind: string; title: string; status?: string },
  incoming: { kind: string; title: string; status?: string },
): boolean {
  if (existing.kind !== incoming.kind || existing.title !== incoming.title) {
    return false;
  }
  return Boolean(existing.status || incoming.status);
}

function mergeActivityEvent(
  events: ChatTurn['activity'],
  incoming: ChatTurn['activity'][number],
): ChatTurn['activity'] {
  let replacementIndex = -1;
  for (let i = events.length - 1; i >= 0; i -= 1) {
    if (shouldReplaceActivity(events[i]!, incoming)) {
      replacementIndex = i;
      break;
    }
  }
  if (replacementIndex >= 0) {
    const next = [...events];
    next[replacementIndex] = {
      ...next[replacementIndex],
      ...incoming,
      detail: incoming.detail ?? next[replacementIndex]?.detail,
    };
    return next;
  }
  return [...events, incoming];
}

function uid(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

function toChatTurn(message: ChatMessageView): ChatTurn {
  return {
    id: message.id,
    role: message.role,
    text: message.text,
    mode: message.mode,
    activity: message.activity ?? [],
    ...(message.fileChanges ? { fileChanges: message.fileChanges } : {}),
    ...(message.status ? { status: message.status } : {}),
    ...(message.route !== undefined ? { route: message.route } : {}),
  };
}

function mergeModelOptions(
  available: string[] | undefined,
  current: string,
): string[] {
  const set = new Set<string>();
  if (current.trim()) set.add(current.trim());
  for (const id of available ?? []) {
    if (id.trim()) set.add(id.trim());
  }
  return [...set];
}

export function App() {
  const [nav, setNav] = useState<UiNav>('chat');
  const [settingsTab, setSettingsTab] = useState<SettingsTab>('workspace');
  const [mode, setMode] = useState<AgentUiMode>('ask');
  const [depth, setDepth] = useState<AgentUiDepth>('auto');
  const [prompt, setPrompt] = useState('');
  const [pinned, setPinned] = useState<ContextPin[]>([]);
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<PathSuggestion[]>([]);
  const [suggestOpen, setSuggestOpen] = useState(false);
  const [suggestLoading, setSuggestLoading] = useState(false);
  const [suggestQuery, setSuggestQuery] = useState('');
  const [activeSuggest, setActiveSuggest] = useState(0);
  const [workspace, setWorkspace] = useState<WorkspaceSnapshotInfo>({});
  const [provider, setProvider] = useState<ProviderSettingsSnapshot>({
    type: 'echo',
    baseUrl: '',
    model: '',
    hasApiKey: false,
    availableModels: [],
    contextWindow: 32768,
    maximumOutputTokens: 16384,
  });
  const [tokenUsage, setTokenUsage] =
    useState<TokenUsageSnapshot>(EMPTY_TOKEN_USAGE);
  const [testingConnection, setTestingConnection] = useState(false);
  const [connectionMessage, setConnectionMessage] = useState<string | null>(
    null,
  );
  const [customModel, setCustomModel] = useState(false);
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const [index, setIndex] = useState<IndexStatusSnapshot>({
    fileCount: 0,
    truncated: false,
  });
  const [mcp, setMcp] = useState<McpSettings>({ enabled: false, servers: [] });
  const [mcpStore, setMcpStore] = useState<McpServerConfig[]>([]);
  const [mcpRuntimeStatus, setMcpRuntimeStatus] =
    useState<McpRuntimeStatus>('disabled');
  const [ui, setUi] = useState<UiSettingsSnapshot>(DEFAULT_UI);
  const [clarifyText, setClarifyText] = useState('');
  const [activityOpen, setActivityOpen] = useState(true);
  const [overrideDraft, setOverrideDraft] = useState('');
  const [notice, setNotice] = useState<WorkspaceNoticeView | null>(null);
  const [onboardingRequired, setOnboardingRequired] = useState(false);
  const [skillManagement, setSkillManagement] = useState(false);
  const [history, setHistory] = useState<ChatThreadSummary[]>([]);
  const [activeThreadId, setActiveThreadId] = useState<string | undefined>();
  const [memories, setMemories] = useState<MemoryItemView[]>([]);
  const [checkpoints, setCheckpoints] = useState<CheckpointItemView[]>([]);
  const [plan, setPlan] = useState<PlanView | null>(null);
  const [pendingPlan, setPendingPlan] = useState<PlanView | null>(null);
  const pendingPlanRef = useRef<PlanView | null>(null);
  const [review, setReview] = useState<ReviewDiffView | null>(null);
  const [skillItems, setSkillItems] = useState<SkillCatalogItem[]>([]);
  const [skillError, setSkillError] = useState<string | null>(null);
  const [skillLoading, setSkillLoading] = useState(false);

  const searchReq = useRef(0);
  const lastSearchId = useRef('');
  const messagesRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const modelMenuRef = useRef<HTMLDivElement>(null);
  const stickToBottomRef = useRef(true);
  const forceScrollToBottomRef = useRef(false);
  const lastTurnCountRef = useRef(0);
  const activeAssistantId = useRef<string | null>(null);

  const applyTokenUsage = useCallback(
    (usage: TokenUsageSnapshot) => {
      setTokenUsage((prev) => {
        const shouldKeepLiveBreakdown =
          usage.contextBreakdown === undefined && usage.live && prev.live;
        return {
          ...usage,
          contextWindow:
            usage.contextWindow ||
            provider.contextWindow ||
            prev.contextWindow ||
            32768,
          contextBreakdown:
            usage.contextBreakdown ??
            (shouldKeepLiveBreakdown ? prev.contextBreakdown : undefined),
        };
      });
    },
    [provider.contextWindow],
  );

  const scrollMessagesToBottom = useCallback((behavior: ScrollBehavior) => {
    const scroll = () => {
      const target = messagesRef.current;
      if (!target) return;
      bottomRef.current?.scrollIntoView({ block: 'end', behavior });
      target.scrollTop = target.scrollHeight;
    };
    window.requestAnimationFrame(() => {
      scroll();
      window.requestAnimationFrame(scroll);
    });
  }, []);

  const navigate = useCallback(
    (next: UiNav, nextSettingsTab?: SettingsTab) => {
      setNav(next);
      if (nextSettingsTab) setSettingsTab(nextSettingsTab);
      postToHost({
        type: 'navigate',
        nav: next,
        settingsTab: nextSettingsTab,
      });
    },
    [],
  );

  const applyBootstrap = useCallback((msg: HostToWebviewMessage) => {
    if (msg.type === 'bootstrap' || msg.type === 'settings') {
      setWorkspace(msg.workspace);
      setProvider({
        ...msg.provider,
        contextWindow: msg.provider.contextWindow || 32768,
        maximumOutputTokens: msg.provider.maximumOutputTokens || 16384,
      });
      setMcp(msg.mcp);
      setMcpStore(msg.mcpStore ?? []);
      setMcpRuntimeStatus(msg.mcpRuntimeStatus);
      setUi({
        ...DEFAULT_UI,
        ...msg.ui,
        contextToggles: {
          ...DEFAULT_CONTEXT_TOGGLES,
          ...msg.ui.contextToggles,
        },
        runBudget: {
          ...DEFAULT_RUN_BUDGET,
          ...msg.ui.runBudget,
        },
      });
      setDepth(msg.ui.depth);
      setOverrideDraft(msg.workspace.rootOverride ?? '');
      applyTokenUsage(msg.tokenUsage);
      setNotice(msg.notice);
      setCustomModel(false);
      if (msg.provider.connectionStatus) {
        setConnectionMessage(msg.provider.connectionStatus);
      }
      if (msg.type === 'bootstrap') {
        setIndex(msg.index);
        setOnboardingRequired(msg.onboardingRequired);
        setSkillManagement(msg.flags.skillManagement);
        setHistory(msg.history);
        setActiveThreadId(msg.activeThreadId);
        if (!activeAssistantId.current) {
          setTurns(
            (msg.activeThreadMessages ?? []).map((m) => toChatTurn(m)),
          );
        }
        const bootstrapPlan = msg.pendingPlan ?? null;
        setPendingPlan(bootstrapPlan);
        if (bootstrapPlan) setPlan(bootstrapPlan);
        setMemories(msg.memories);
        setCheckpoints(msg.checkpoints);
      }
    }
  }, [applyTokenUsage]);

  const markSuspensionResumed = useCallback((runId: string) => {
    setRunning(true);
    setTurns((prev) =>
      prev.map((turn) =>
        turn.suspension?.runId === runId
          ? { ...turn, suspension: undefined, streaming: true }
          : turn,
      ),
    );
  }, []);

  useEffect(() => {
    pendingPlanRef.current = pendingPlan;
  }, [pendingPlan]);

  useEffect(() => {
    const off = onHostMessage((msg) => {
      switch (msg.type) {
        case 'bootstrap':
        case 'settings':
          applyBootstrap(msg);
          break;
        case 'index.status':
          setIndex(msg.index);
          break;
        case 'run.started': {
          setRunning(true);
          setError(null);
          // Keep a pending-plan handoff visible, but clear stale plans for new runs.
          if (msg.mode === 'plan' || !pendingPlanRef.current) setPlan(null);
          stickToBottomRef.current = true;
          forceScrollToBottomRef.current = true;
          const userId = uid('user');
          const asstId = uid('asst');
          activeAssistantId.current = asstId;
          setTurns((prev) => [
            ...prev,
            {
              id: userId,
              role: 'user',
              text: msg.prompt,
              mode: msg.mode,
              activity: [],
            },
            {
              id: asstId,
              role: 'assistant',
              text: '',
              mode: msg.mode,
              streaming: true,
              activity: [],
            },
          ]);
          break;
        }
        case 'run.event': {
          const id = activeAssistantId.current;
          if (!id) break;
          setTurns((prev) =>
            prev.map((t) => {
              if (t.id !== id) return t;
              const nextActivity = [...t.activity];
              if (msg.event.kind === 'thinking' && ui.showReasoning) {
                const last = nextActivity[nextActivity.length - 1];
                if (last?.kind === 'thinking') {
                  const merged = {
                    ...last,
                    detail: `${last.detail ?? ''}${msg.event.detail ?? ''}`.slice(
                      -ui.reasoningPreviewMaxChars,
                    ),
                  };
                  nextActivity[nextActivity.length - 1] = merged;
                  return { ...t, activity: nextActivity };
                }
              }
              if (msg.event.kind === 'thinking' && !ui.showReasoning) {
                return t;
              }
              if (msg.event.kind === 'delta') {
                return t;
              }
              return {
                ...t,
                activity: mergeActivityEvent(nextActivity, msg.event).slice(-60),
              };
            }),
          );
          break;
        }
        case 'run.delta': {
          const id = activeAssistantId.current;
          if (!id) break;
          setTurns((prev) =>
            prev.map((t) =>
              t.id === id ? { ...t, text: `${t.text}${msg.text}` } : t,
            ),
          );
          break;
        }
        case 'run.suspended': {
          setRunning(false);
          const id = activeAssistantId.current;
          if (!id) break;
          setTurns((prev) =>
            prev.map((t) =>
              t.id === id
                ? { ...t, suspension: msg.suspension, streaming: false }
                : t,
            ),
          );
          break;
        }
        case 'run.resumed':
          markSuspensionResumed(msg.runId);
          break;
        case 'run.result': {
          setRunning(false);
          const id = activeAssistantId.current;
          activeAssistantId.current = null;
          if (msg.plan !== undefined) setPlan(msg.plan ?? null);
          if (msg.pendingPlan !== undefined) {
            setPendingPlan(msg.pendingPlan);
            if (msg.pendingPlan) setPlan(msg.pendingPlan);
          }
          setTurns((prev) =>
            prev.map((t) => {
              if (!id || t.id !== id) return t;
              const nextText = resolveDisplayedAssistantText({
                streamedText: t.text,
                finalAnswer: msg.answer?.trim()
                  ? msg.answer
                  : msg.error
                    ? `Error: ${msg.error}`
                    : `(${msg.status})`,
              });
              return {
                ...t,
                streaming: false,
                status: msg.status,
                route: msg.route,
                text: nextText,
                suspension: undefined,
              };
            }),
          );
          break;
        }
        case 'run.cancelled':
          setRunning(false);
          break;
        case 'error':
          setError(msg.message);
          setRunning(false);
          break;
        case 'paths.results':
          if (msg.requestId === lastSearchId.current) {
            setSuggestions(msg.suggestions);
            setSuggestLoading(false);
            setSuggestOpen(true);
            setActiveSuggest(0);
          }
          break;
        case 'openSettings':
          setNav('settings');
          if (msg.tab) setSettingsTab(msg.tab);
          break;
        case 'setTab':
          setNav(msg.tab);
          break;
        case 'editorPin':
          setPinned((prev) => {
            const source = msg.source ?? 'auto';
            const existing = prev.find((p) => p.path === msg.path);
            if (existing) {
              // Promote auto → user when explicitly pinned again as user.
              if (source === 'user' && existing.source === 'auto') {
                return prev.map((p) =>
                  p.path === msg.path ? { ...p, source: 'user' } : p,
                );
              }
              return prev;
            }
            return [...prev, { path: msg.path, source }];
          });
          break;
        case 'editorUnpin':
          setPinned((prev) =>
            prev.filter(
              (p) => !(p.path === msg.path && p.source === 'auto'),
            ),
          );
          break;
        case 'syncAutoPins': {
          const open = new Set(msg.paths);
          setPinned((prev) => {
            const kept = prev.filter(
              (p) => p.source === 'user' || open.has(p.path),
            );
            const known = new Set(kept.map((p) => p.path));
            const additions = msg.paths
              .filter((path) => !known.has(path))
              .map((path) => ({ path, source: 'auto' as const }));
            return [...kept, ...additions];
          });
          break;
        }
        case 'run.fileChanges': {
          const id = activeAssistantId.current;
          setTurns((prev) => {
            const targetId =
              id ??
              [...prev]
                .reverse()
                .find((turn) => turn.role === 'assistant')?.id;
            if (!targetId) return prev;
            return prev.map((t) =>
              t.id === targetId ? { ...t, fileChanges: msg.changes } : t,
            );
          });
          break;
        }
        case 'fileChanges.undone': {
          setTurns((prev) =>
            prev.map((t) =>
              t.fileChanges?.runId === msg.runId
                ? { ...t, fileChanges: undefined }
                : t,
            ),
          );
          break;
        }
        case 'workspaceNotice':
          setNotice(msg.notice);
          break;
        case 'history':
          setHistory(msg.threads);
          setActiveThreadId(msg.activeThreadId);
          break;
        case 'thread.loaded': {
          setActiveThreadId(msg.threadId);
          stickToBottomRef.current = true;
          forceScrollToBottomRef.current = true;
          setTokenUsage({
            ...EMPTY_TOKEN_USAGE,
            contextWindow: provider.contextWindow || 32768,
          });
          setTurns(msg.messages.map((m) => toChatTurn(m)));
          const loadedPlan = msg.pendingPlan ?? null;
          setPendingPlan(loadedPlan);
          setPlan(loadedPlan);
          setNav('chat');
          break;
        }
        case 'setPlan':
          setPlan(msg.plan);
          break;
        case 'setReviewDiff':
          setReview(msg.review);
          break;
        case 'setMemories':
          setMemories(msg.memories);
          break;
        case 'setCheckpoints':
          setCheckpoints(msg.checkpoints);
          break;
        case 'skillCatalogResult':
          setSkillItems(msg.items);
          setSkillError(msg.error ?? null);
          setSkillLoading(false);
          break;
        case 'onboarding':
          setOnboardingRequired(msg.required);
          break;
        case 'provider.connectionResult':
          setTestingConnection(Boolean(msg.testing));
          setConnectionMessage(msg.message);
          if (msg.models?.length) {
            setProvider((p) => ({
              ...p,
              availableModels: mergeModelOptions(msg.models, p.model),
              connectionOk: msg.ok,
              connectionStatus: msg.message,
            }));
          } else if (!msg.testing) {
            setProvider((p) => ({
              ...p,
              connectionOk: msg.ok,
              connectionStatus: msg.message,
            }));
          }
          break;
        case 'tokenUsage':
          applyTokenUsage(msg.usage);
          break;
        default:
          break;
      }
    });
    postToHost({ type: 'ready' });
    return off;
  }, [
    applyBootstrap,
    applyTokenUsage,
    markSuspensionResumed,
    provider.contextWindow,
    ui.reasoningPreviewMaxChars,
    ui.showReasoning,
  ]);

  useLayoutEffect(() => {
    const turnCountChanged = turns.length !== lastTurnCountRef.current;
    lastTurnCountRef.current = turns.length;
    const shouldScroll =
      forceScrollToBottomRef.current ||
      stickToBottomRef.current ||
      (running && turnCountChanged);
    if (!shouldScroll) return;
    forceScrollToBottomRef.current = false;
    scrollMessagesToBottom(running ? 'auto' : 'smooth');
  }, [running, scrollMessagesToBottom, turns]);

  const onMessagesScroll = useCallback(() => {
    const target = messagesRef.current;
    if (!target) return;
    const distanceFromBottom =
      target.scrollHeight - target.scrollTop - target.clientHeight;
    stickToBottomRef.current = distanceFromBottom < 72;
  }, []);

  const send = useCallback(() => {
    const text = prompt.trim();
    if (!text || running) return;
    stickToBottomRef.current = true;
    forceScrollToBottomRef.current = true;
    postToHost({
      type: 'ask',
      prompt: text,
      mode,
      depth,
      pinnedPaths: pinned.map((p) => p.path),
    });
    setPrompt('');
    setSuggestLoading(false);
    setSuggestOpen(false);
  }, [prompt, running, mode, depth, pinned]);

  const executePendingPlan = useCallback(() => {
    if (running) return;
    stickToBottomRef.current = true;
    forceScrollToBottomRef.current = true;
    setMode('agent');
    postToHost({
      type: 'ask',
      prompt: 'Implement the pending plan.',
      mode: 'agent',
      depth,
      pinnedPaths: pinned.map((p) => p.path),
    });
    setPrompt('');
    setSuggestLoading(false);
    setSuggestOpen(false);
  }, [running, depth, pinned]);

  const onPromptChange = (value: string) => {
    setPrompt(value);
    const match = value.match(/@([\w./_-]*)$/);
    if (match) {
      const q = match[1] ?? '';
      setSuggestQuery(q);
      const requestId = String(++searchReq.current);
      lastSearchId.current = requestId;
      setSuggestLoading(true);
      setSuggestOpen(true);
      postToHost({ type: 'paths.search', query: q, requestId });
    } else {
      setSuggestLoading(false);
      setSuggestOpen(false);
    }
  };

  const insertMention = (path: string) => {
    const replaced = prompt.replace(/@([\w./_-]*)$/, `@${path} `);
    setPrompt(replaced);
    setPinned((prev) => {
      const existing = prev.find((p) => p.path === path);
      if (existing) {
        return existing.source === 'user'
          ? prev
          : prev.map((p) =>
              p.path === path ? { ...p, source: 'user' } : p,
            );
      }
      return [...prev, { path, source: 'user' }];
    });
    setSuggestLoading(false);
    setSuggestOpen(false);
  };

  const openFile = useCallback(
    (path: string, line?: number, column?: number) => {
      postToHost({ type: 'openFile', path, line, column });
    },
    [],
  );

  const undoFileChanges = useCallback((runId: string) => {
    postToHost({ type: 'undoFileChanges', runId });
  }, []);

  const reviewFileChange = useCallback((runId: string, path: string) => {
    postToHost({ type: 'reviewFileChange', runId, path });
  }, []);

  const reviewAllFileChanges = useCallback((changes: RunFileChangesView) => {
    setMode('review');
    postToHost({ type: 'refreshReviewDiff' });
    for (const file of changes.files.slice(0, 1)) {
      postToHost({
        type: 'reviewFileChange',
        runId: changes.runId,
        path: file.path,
      });
    }
  }, []);

  const dismissFileChanges = useCallback((runId: string) => {
    postToHost({ type: 'dismissFileChanges', runId });
    setTurns((prev) =>
      prev.map((t) =>
        t.fileChanges?.runId === runId
          ? { ...t, fileChanges: undefined }
          : t,
      ),
    );
  }, []);

  const currentModeColor = modeColor(mode);

  const saveProvider = () => {
    postToHost({
      type: 'settings.set',
      provider: {
        type: provider.type,
        preset: provider.preset,
        baseUrl: provider.baseUrl,
        model: provider.model,
        contextWindow: provider.contextWindow,
        maximumOutputTokens: provider.maximumOutputTokens,
      },
    });
    setTokenUsage((prev) => ({
      ...prev,
      contextWindow: provider.contextWindow || prev.contextWindow,
    }));
  };

  const testConnection = () => {
    setTestingConnection(true);
    setConnectionMessage('Testing…');
    postToHost({
      type: 'provider.testConnection',
      provider: {
        type: provider.type,
        baseUrl: provider.baseUrl,
        model: provider.model,
      },
    });
  };

  const onProviderTypeChange = (presetId: string) => {
    const preset = getProviderPreset(presetId);
    const type = preset?.type ?? presetId;
    setProvider((p) => ({
      ...p,
      type,
      preset: preset?.preset ?? presetId,
      baseUrl: preset?.baseUrl ?? p.baseUrl,
      model: preset?.model ?? p.model,
      connectionOk: undefined,
      connectionStatus: undefined,
    }));
    setConnectionMessage(null);
    setCustomModel(false);
  };

  const modelOptions = useMemo(
    () => mergeModelOptions(provider.availableModels, provider.model),
    [provider.availableModels, provider.model],
  );
  const selectedModelIsCustom =
    customModel || !modelOptions.includes(provider.model);
  const selectedModelLabel = selectedModelIsCustom
    ? provider.model.trim() || 'Custom model'
    : provider.model || 'Select model';

  const saveModel = (model: string) => {
    setProvider((p) => ({ ...p, model }));
    postToHost({
      type: 'settings.set',
      provider: { model },
    });
  };

  useEffect(() => {
    if (!modelMenuOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!modelMenuRef.current?.contains(event.target as Node)) {
        setModelMenuOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setModelMenuOpen(false);
    };
    window.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [modelMenuOpen]);

  const saveUi = (patch: UiSettingsPatch) => {
    const next = {
      ...ui,
      ...patch,
      contextToggles: patch.contextToggles
        ? { ...ui.contextToggles, ...patch.contextToggles }
        : ui.contextToggles,
      runBudget: patch.runBudget
        ? { ...ui.runBudget, ...patch.runBudget }
        : ui.runBudget,
    };
    setUi(next);
    if (patch.depth) setDepth(patch.depth);
    postToHost({
      type: 'settings.set',
      ui: patch,
      approvalMode: patch.approvalMode,
    });
  };

  const setApprovalMode = (approvalMode: ApprovalUiMode) => {
    saveUi({ approvalMode });
  };

  const saveMcp = (next: McpSettings) => {
    setMcp(next);
    postToHost({ type: 'settings.set', mcp: next });
  };

  const requestSkills = () => {
    setSkillLoading(true);
    postToHost({ type: 'requestSkillCatalog', requestId: uid('skill') });
  };

  useEffect(() => {
    if (nav === 'skills' && skillManagement) requestSkills();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nav, skillManagement]);

  const followingPlan = Boolean(plan) && mode === 'agent';

  if (onboardingRequired) {
    return (
      <div className="app">
        <header className="shell-header">
          <div className="brand">
            <div className="brand-mark">Mitii</div>
            <div className="brand-sub">First-run setup</div>
          </div>
        </header>
        <OnboardingPanel
          index={index}
          onIndex={() => postToHost({ type: 'index.reindex' })}
          onComplete={() => {
            postToHost({ type: 'completeOnboarding' });
            setOnboardingRequired(false);
          }}
          onOpenSettings={() => {
            setOnboardingRequired(false);
            navigate('settings', 'model');
          }}
        />
      </div>
    );
  }

  return (
    <div className="app">
      <header className="shell-header">
        <div className="brand">
          <div className="brand-mark">Mitii</div>
          <div className="brand-sub">Enterprise workspace agent</div>
        </div>
        <div className="shell-header__actions">
          <nav className="nav-pills" aria-label="Primary">
            {nav === 'chat' ? (
              <IconButton
                label="New chat"
                onClick={() => {
                  postToHost({ type: 'newChat' });
                  setTurns([]);
                  setPlan(null);
                  setPendingPlan(null);
                  setActiveThreadId(undefined);
                  setTokenUsage(EMPTY_TOKEN_USAGE);
                }}
              >
                <IconPlus />
              </IconButton>
            ) : null}
            <IconButton
              label="Chat"
              active={nav === 'chat'}
              onClick={() => navigate('chat')}
            >
              <IconChat />
            </IconButton>
            <IconButton
              label="History"
              active={nav === 'history'}
              onClick={() => navigate('history')}
            >
              <IconHistory />
            </IconButton>
            <IconButton
              label="Settings"
              active={nav === 'settings'}
              onClick={() => navigate('settings', settingsTab)}
            >
              <IconSettings />
            </IconButton>
            {skillManagement ? (
              <IconButton
                label="Skills"
                active={nav === 'skills'}
                onClick={() => navigate('skills')}
              >
                <IconSkills />
              </IconButton>
            ) : null}
          </nav>
          <IndexingStatusBar
            index={index}
            onRefresh={() => postToHost({ type: 'index.refresh' })}
            onOpenSettings={() => navigate('settings', 'workspace')}
          />
        </div>
      </header>

      <ErrorBanner
        error={error}
        onDismiss={() => setError(null)}
        onSettings={() => navigate('settings', 'model')}
      />
      <WorkspaceBanner notice={notice} workspace={workspace} />

      {nav === 'chat' ? (
        mode === 'review' ? (
          <div className="chat-view">
            <ReviewPanel
              review={review}
              onRefresh={() => postToHost({ type: 'refreshReviewDiff' })}
            />
            <div className="composer-dock">
              <ComposerControls
                mode={mode}
                approvalMode={ui.approvalMode}
                depth={depth}
                onModeChange={setMode}
                onApprovalModeChange={setApprovalMode}
                onDepthChange={(next) => {
                  setDepth(next);
                  saveUi({ depth: next });
                }}
              />
            </div>
          </div>
        ) : (
          <div className={`chat-view${running ? ' chat-view--running' : ''}`}>
            <MessageList
              turns={turns}
              activityOpen={activityOpen}
              onToggleActivity={() => setActivityOpen((v) => !v)}
              clarifyText={clarifyText}
              onClarifyChange={setClarifyText}
              onResumeClarify={(runId, answer) => {
                postToHost({
                  type: 'resume',
                  runId,
                  clarificationAnswer: answer,
                });
                markSuspensionResumed(runId);
                setClarifyText('');
              }}
              onResumeStop={(runId) => postToHost({ type: 'resume', runId })}
              onApprove={(runId, approvalId) => {
                const turn = turns.find((t) => t.suspension?.runId === runId);
                if (turn?.suspension?.kind === 'plan_approval_required') {
                  postToHost({
                    type: 'resume',
                    runId,
                    planDecision: { decision: 'approved' },
                  });
                  markSuspensionResumed(runId);
                  return;
                }
                if (!approvalId) return;
                postToHost({
                  type: 'resume',
                  runId,
                  approval: { approvalId, decision: 'approved' },
                });
                markSuspensionResumed(runId);
              }}
              onDeny={(runId, approvalId) => {
                const turn = turns.find((t) => t.suspension?.runId === runId);
                if (turn?.suspension?.kind === 'plan_approval_required') {
                  postToHost({
                    type: 'resume',
                    runId,
                    planDecision: { decision: 'rejected' },
                  });
                  markSuspensionResumed(runId);
                  return;
                }
                if (!approvalId) return;
                postToHost({
                  type: 'resume',
                  runId,
                  approval: { approvalId, decision: 'denied' },
                });
                markSuspensionResumed(runId);
              }}
              onShowInlineDiff={(approvalId) =>
                postToHost({ type: 'showInlineDiff', approvalId })
              }
              onOpenFile={openFile}
              onUndoFileChanges={undoFileChanges}
              onReviewFileChange={reviewFileChange}
              onReviewAllFileChanges={reviewAllFileChanges}
              onDismissFileChanges={dismissFileChanges}
              containerRef={messagesRef}
              onScroll={onMessagesScroll}
              bottomRef={bottomRef}
            />

            <div className="composer-dock">
              <PendingPlanBanner
                visible={Boolean(pendingPlan) && mode !== 'agent'}
                onExecuteInAgent={executePendingPlan}
                onDismiss={() => {
                  setPendingPlan(null);
                  setPlan(null);
                  postToHost({ type: 'clearPendingPlan' });
                }}
              />
              {followingPlan ? (
                <PlanFollowStrip
                  plan={plan}
                  running={running}
                  onOpenPlanFile={openFile}
                />
              ) : null}
              <div className="composer-box">
                <ContextPanel
                  pins={pinned}
                  modeColor={currentModeColor}
                  onRemove={(path) =>
                    setPinned((prev) => prev.filter((x) => x.path !== path))
                  }
                  onClear={() => setPinned([])}
                  onPick={() => postToHost({ type: 'pickContextPath' })}
                  onKeep={(path) =>
                    setPinned((prev) =>
                      prev.map((p) =>
                        p.path === path ? { ...p, source: 'user' } : p,
                      ),
                    )
                  }
                />
                {suggestOpen ? (
                  <div className="suggest-pop" role="listbox">
                    {suggestLoading ? (
                      <div className="suggest-item suggest-item--loading">
                        <span className="mono">Loading files…</span>
                      </div>
                    ) : null}
                    {!suggestLoading && suggestions.length === 0 ? (
                      <div className="suggest-item suggest-item--loading">
                        <span className="mono">No matching files</span>
                      </div>
                    ) : null}
                    {!suggestLoading ? suggestions.map((s, i) => (
                      <button
                        key={s.path}
                        type="button"
                        className={`suggest-item ${i === activeSuggest ? 'active' : ''}`}
                        onClick={() => insertMention(s.path)}
                      >
                        <span className="mono">@{s.path}</span>
                        <span className="suggest-kind">{s.kind}</span>
                      </button>
                    )) : null}
                  </div>
                ) : null}
                <textarea
                  value={prompt}
                  placeholder={`Message Mitii… type @ for context (${suggestQuery ? `filter: ${suggestQuery}` : 'files'})`}
                  onChange={(e) => onPromptChange(e.target.value)}
                  onKeyDown={(e) => {
                    if (suggestOpen && suggestions.length) {
                      if (e.key === 'ArrowDown') {
                        e.preventDefault();
                        setActiveSuggest((i) => (i + 1) % suggestions.length);
                        return;
                      }
                      if (e.key === 'ArrowUp') {
                        e.preventDefault();
                        setActiveSuggest(
                          (i) =>
                            (i - 1 + suggestions.length) % suggestions.length,
                        );
                        return;
                      }
                      if (e.key === 'Enter' || e.key === 'Tab') {
                        e.preventDefault();
                        insertMention(suggestions[activeSuggest]!.path);
                        return;
                      }
                      if (e.key === 'Escape') {
                        setSuggestOpen(false);
                        return;
                      }
                    }
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      send();
                    }
                  }}
                />
                <div className="composer-footer">
                  <div className="composer-dropdown-row--with-model">
                    <ComposerControls
                      mode={mode}
                      approvalMode={ui.approvalMode}
                      depth={depth}
                      onModeChange={setMode}
                      onApprovalModeChange={setApprovalMode}
                      onDepthChange={(next) => {
                        setDepth(next);
                        saveUi({ depth: next });
                      }}
                    />
                    <div
                      className="composer-dropdown composer-dropdown--model"
                      ref={modelMenuRef}
                      style={
                        {
                          '--composer-control-color': '#38bdf8',
                        } as CSSProperties
                      }
                    >
                      <button
                        type="button"
                        className="composer-dropdown__button composer-dropdown__button--link"
                        aria-haspopup="listbox"
                        aria-expanded={modelMenuOpen}
                        aria-label="Model"
                        title={`Model: ${selectedModelLabel}`}
                        onClick={() => setModelMenuOpen((open) => !open)}
                      >
                        <span className="composer-dropdown__value">
                          <span className="composer-dropdown__icon" aria-hidden>
                            <IconModel />
                          </span>
                          <span>{selectedModelLabel}</span>
                        </span>
                        <span className="composer-dropdown__chevron" aria-hidden>
                          ▾
                        </span>
                      </button>
                      {modelMenuOpen ? (
                        <div
                          className="composer-dropdown__menu"
                          role="listbox"
                          aria-label="Model"
                        >
                          {modelOptions.map((id) => {
                            const selectedOption =
                              !selectedModelIsCustom && id === provider.model;
                            return (
                              <button
                                key={id}
                                type="button"
                                className={[
                                  'composer-dropdown__option',
                                  selectedOption
                                    ? 'composer-dropdown__option--selected'
                                    : '',
                                ]
                                  .filter(Boolean)
                                  .join(' ')}
                                style={
                                  {
                                    '--composer-option-color': '#38bdf8',
                                  } as CSSProperties
                                }
                                role="option"
                                aria-selected={selectedOption}
                                title={`Use ${id}`}
                                onClick={() => {
                                  setCustomModel(false);
                                  setModelMenuOpen(false);
                                  saveModel(id);
                                }}
                              >
                                <span
                                  className="composer-dropdown__option-icon"
                                  aria-hidden
                                >
                                  <IconModel />
                                </span>
                                <span className="composer-dropdown__option-text">
                                  <span>{id}</span>
                                  <small>Use this model</small>
                                </span>
                                {selectedOption ? (
                                  <span
                                    className="composer-dropdown__option-check"
                                    aria-hidden
                                  >
                                    <IconCheck />
                                  </span>
                                ) : (
                                  <span
                                    className="composer-dropdown__option-check"
                                    aria-hidden
                                  />
                                )}
                              </button>
                            );
                          })}
                          <button
                            type="button"
                            className={[
                              'composer-dropdown__option',
                              selectedModelIsCustom
                                ? 'composer-dropdown__option--selected'
                                : '',
                            ]
                              .filter(Boolean)
                              .join(' ')}
                            role="option"
                            aria-selected={selectedModelIsCustom}
                            title="Enter a custom model id"
                            onClick={() => {
                              setCustomModel(true);
                              setModelMenuOpen(false);
                            }}
                          >
                            <span
                              className="composer-dropdown__option-icon"
                              aria-hidden
                            >
                              <IconModel />
                            </span>
                            <span className="composer-dropdown__option-text">
                              <span>Custom model</span>
                              <small>Type a model id manually</small>
                            </span>
                            {selectedModelIsCustom ? (
                              <span
                                className="composer-dropdown__option-check"
                                aria-hidden
                              >
                                <IconCheck />
                              </span>
                            ) : (
                              <span
                                className="composer-dropdown__option-check"
                                aria-hidden
                              />
                            )}
                          </button>
                        </div>
                      ) : null}
                    </div>
                    {selectedModelIsCustom ? (
                      <input
                        className="model-custom-input"
                        value={provider.model}
                        placeholder="model id"
                        onChange={(e) =>
                          setProvider((p) => ({
                            ...p,
                            model: e.target.value,
                          }))
                        }
                        onBlur={() => {
                          if (provider.model.trim())
                            saveModel(provider.model.trim());
                        }}
                        title="Custom model id"
                      />
                    ) : null}
                  </div>
                  <div className="composer-utility-row">
                    <div className="composer-left">
                      <TokenMeter usage={tokenUsage} placement="above" />
                    </div>
                    <div className="composer-actions">
                      <IconButton
                        label="Copy last response"
                        onClick={() =>
                          postToHost({ type: 'copyLastResponse' })
                        }
                      >
                        <IconCopy />
                      </IconButton>
                      {running ? (
                        <IconButton
                          label="Stop"
                          className="icon-btn--danger"
                          onClick={() => postToHost({ type: 'cancel' })}
                        >
                          <IconStop />
                        </IconButton>
                      ) : (
                        <IconButton
                          label="Send"
                          className="icon-btn--mode"
                          style={
                            {
                              '--composer-control-color': currentModeColor,
                            } as CSSProperties
                          }
                          onClick={send}
                          disabled={!prompt.trim()}
                        >
                          <IconSend />
                        </IconButton>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )
      ) : null}

      {nav === 'history' ? (
        <HistoryPanel
          threads={history}
          activeThreadId={activeThreadId}
          onOpen={(id) => postToHost({ type: 'openChatThread', id })}
          onDelete={(id) => postToHost({ type: 'deleteChatThread', id })}
          onClear={() => postToHost({ type: 'clearChatHistory' })}
        />
      ) : null}

      {nav === 'settings' ? (
        <SettingsPanel
          tab={settingsTab}
          onTabChange={(tab) => {
            setSettingsTab(tab);
            navigate('settings', tab);
          }}
          workspace={workspace}
          overrideDraft={overrideDraft}
          onOverrideDraftChange={setOverrideDraft}
          onSaveOverride={() =>
            postToHost({
              type: 'settings.set',
              workspaceRootOverride: overrideDraft.trim() || null,
            })
          }
          onClearOverride={() => {
            setOverrideDraft('');
            postToHost({ type: 'settings.set', workspaceRootOverride: null });
          }}
          onOpenFolder={() => postToHost({ type: 'openFolder' })}
          provider={provider}
          onProviderChange={setProvider}
          onProviderTypeChange={onProviderTypeChange}
          onSaveProvider={saveProvider}
          onSetApiKey={() => postToHost({ type: 'settings.setApiKey' })}
          onClearApiKey={() => postToHost({ type: 'settings.clearApiKey' })}
          onTestConnection={testConnection}
          testingConnection={testingConnection}
          connectionMessage={connectionMessage}
          customModel={customModel}
          onCustomModelChange={setCustomModel}
          modelOptions={modelOptions}
          ui={ui}
          onSaveUi={saveUi}
          mcp={mcp}
          mcpStore={mcpStore}
          mcpRuntimeStatus={mcpRuntimeStatus}
          onMcpChange={setMcp}
          onSaveMcp={saveMcp}
          index={index}
          onReindex={() => postToHost({ type: 'index.reindex' })}
          onRefreshIndex={() => postToHost({ type: 'index.refresh' })}
          memories={memories}
          onAddMemory={(text) => postToHost({ type: 'addMemory', text })}
          onDeleteMemory={(id) => postToHost({ type: 'deleteMemory', id })}
          onClearMemory={() => postToHost({ type: 'clearMemory' })}
          checkpoints={checkpoints}
          onRestoreCheckpoint={(id) =>
            postToHost({ type: 'restoreCheckpoint', id })
          }
          onDeleteCheckpoint={(id) =>
            postToHost({ type: 'deleteCheckpoint', id })
          }
          onClearCheckpoints={() =>
            postToHost({ type: 'clearCheckpoints' })
          }
          onToggleContext={(source, enabled) => {
            setUi((prev) => ({
              ...prev,
              contextToggles: { ...prev.contextToggles, [source]: enabled },
            }));
            postToHost({ type: 'toggleContextSource', source, enabled });
          }}
        />
      ) : null}

      {nav === 'skills' && skillManagement ? (
        <SkillManagementPanel
          items={skillItems}
          error={skillError}
          loading={skillLoading}
        />
      ) : null}
    </div>
  );
}
