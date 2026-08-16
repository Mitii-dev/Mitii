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
import type { ChatTurn, TurnSegment } from './components/MessageList';
import { MessageList } from './components/MessageList';
import {
  ComposerControls,
  normalizeApproval,
  type ApprovalUiMode,
} from './components/ComposerControls';
import { OnboardingPanel } from './components/OnboardingPanel';
import { PendingPlanBanner } from './components/PendingPlanBanner';
import { PlanFollowStrip } from './components/PlanPanel';
import { ReviewPanel } from './components/ReviewPanel';
import { SettingsPanel } from './components/SettingsPanel';
import { SkillManagementPanel } from './components/skills/SkillManagementPanel';
import { WorkspaceBanner } from './components/WorkspaceBanner';
import { getProviderPreset, modelsForProvider } from './providerOptions';
import type {
  ActivityEventPayload,
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
  SettingsProfileView,
  SkillCatalogItem,
  TokenBudgetSettingsSnapshot,
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

const DEFAULT_TOKEN_BUDGET: TokenBudgetSettingsSnapshot = {
  enabled: false,
  policy: {},
  fields: [],
  preview: {
    contextWindowTokens: 32768,
    maximumOutputTokens: 3277,
    toolSchemaTokens: 6554,
    usableInputTokens: 22937,
    repositoryTokens: 6422,
    conversationTokens: 9174,
    planTokens: 1376,
    skillsTokens: 917,
    systemTokens: 5048,
    maxModelCalls: 16,
    maxToolCalls: 32,
    maxUniqueFilesPerCall: 4,
    visiblePlanAffordable: false,
    changeImpactAffordable: false,
    runBudgetUnlimited: false,
    runBudgetMaxModelCalls: 64,
    runBudgetMaxToolCalls: 128,
  },
};

const DEFAULT_UI: UiSettingsSnapshot = {
  showReasoning: true,
  reasoningPreviewMaxChars: 8000,
  depth: 'auto',
  modeDefaults: {
    ask: { depth: 'auto', approvalMode: 'guided', model: '' },
    plan: { depth: 'deep', approvalMode: 'guided', model: '' },
    agent: { depth: 'auto', approvalMode: 'safe', model: '' },
  },
  contextToggles: DEFAULT_CONTEXT_TOGGLES,
  approvalMode: 'guided',
  runBudget: DEFAULT_RUN_BUDGET,
  developerEnabled: false,
  debugLogging: false,
  tokenBudget: DEFAULT_TOKEN_BUDGET,
};

type SettingsMode = 'ask' | 'plan' | 'agent';

function settingsModeFor(mode: AgentUiMode): SettingsMode {
  return mode === 'plan' || mode === 'agent' ? mode : 'ask';
}

function modeDefaultsFromUi(ui: UiSettingsSnapshot, mode: AgentUiMode) {
  const settingsMode = settingsModeFor(mode);
  const fallback = DEFAULT_UI.modeDefaults[settingsMode];
  const current = ui.modeDefaults?.[settingsMode];
  return {
    depth: current?.depth ?? ui.depth ?? fallback.depth,
    approvalMode:
      current?.approvalMode ?? ui.approvalMode ?? fallback.approvalMode,
    model: current?.model ?? fallback.model,
  };
}

function mergeUiPatch(
  base: UiSettingsSnapshot,
  patch: UiSettingsPatch,
): UiSettingsSnapshot {
  return {
    ...base,
    ...patch,
    contextToggles: patch.contextToggles
      ? { ...base.contextToggles, ...patch.contextToggles }
      : base.contextToggles,
    modeDefaults: patch.modeDefaults
      ? {
          ...base.modeDefaults,
          ask: {
            ...base.modeDefaults.ask,
            ...patch.modeDefaults.ask,
          },
          plan: {
            ...base.modeDefaults.plan,
            ...patch.modeDefaults.plan,
          },
          agent: {
            ...base.modeDefaults.agent,
            ...patch.modeDefaults.agent,
          },
        }
      : base.modeDefaults,
    runBudget: patch.runBudget
      ? { ...base.runBudget, ...patch.runBudget }
      : base.runBudget,
    tokenBudget: patch.tokenBudget
      ? {
          ...base.tokenBudget,
          ...patch.tokenBudget,
          policy: {
            ...base.tokenBudget.policy,
            ...(patch.tokenBudget.policy ?? {}),
          },
          fields: base.tokenBudget.fields,
          preview: base.tokenBudget.preview,
        }
      : base.tokenBudget,
  };
}

/** Tool titles switch from "Running X" (started) to plain "X" (completed) — normalize so both merge into one row. */
function activityMergeKey(event: { kind: string; title: string }): string {
  if (event.kind === 'tool') {
    return `tool:${event.title.replace(/^Running\s+/, '')}`;
  }
  return `${event.kind}:${event.title}`;
}

function shouldReplaceActivity(
  existing: { kind: string; title: string; status?: string },
  incoming: { kind: string; title: string; status?: string },
): boolean {
  if (activityMergeKey(existing) !== activityMergeKey(incoming)) return false;
  return Boolean(existing.status || incoming.status);
}

const MAX_SEGMENTS = 160;

/**
 * Appends an activity event to the trailing run of activity segments.
 * Thinking deltas have no `status`, so they merge purely on contiguity with
 * the immediately preceding thinking entry (one growing "Thought" per
 * uninterrupted reasoning phase). Other kinds merge into a matching in-flight
 * entry further back (e.g. a tool's running→done transition) via
 * shouldReplaceActivity, so status updates don't spawn duplicate rows. Either
 * way the search never crosses a text segment boundary — once the model
 * resumes writing prose, a later event starts a fresh step.
 */
function appendActivitySegment(
  segments: TurnSegment[],
  incoming: ActivityEventPayload,
  reasoningPreviewMaxChars: number,
): TurnSegment[] {
  const last = segments[segments.length - 1];

  if (
    incoming.kind === 'thinking' &&
    last?.kind === 'activity' &&
    last.event.kind === 'thinking'
  ) {
    const detail = `${last.event.detail ?? ''}${incoming.detail ?? ''}`.slice(
      -reasoningPreviewMaxChars,
    );
    const next = [...segments];
    next[next.length - 1] = {
      ...last,
      // Keep the original start time so the eventual "Thought for Xs" reflects
      // the whole reasoning phase, not just the gap since the last delta.
      event: { ...last.event, ...incoming, detail, at: last.event.at },
    };
    return next;
  }

  if (incoming.kind !== 'thinking') {
    let start = segments.length;
    while (start > 0 && segments[start - 1]!.kind === 'activity') start -= 1;

    for (let i = segments.length - 1; i >= start; i -= 1) {
      const seg = segments[i]!;
      if (
        seg.kind !== 'activity' ||
        seg.event.kind === 'thinking' ||
        !shouldReplaceActivity(seg.event, incoming)
      ) {
        continue;
      }
      const next = [...segments];
      next[i] = {
        ...seg,
        event: {
          ...seg.event,
          ...incoming,
          detail: incoming.detail ?? seg.event.detail,
          at: seg.event.at,
        },
      };
      return next;
    }
  }

  const next: TurnSegment[] = [
    ...segments,
    { id: uid('seg'), kind: 'activity', event: incoming },
  ];
  return next.length > MAX_SEGMENTS ? next.slice(-MAX_SEGMENTS) : next;
}

/** Appends a text delta, continuing the trailing text segment or starting a new one after an activity phase. */
function appendTextSegment(segments: TurnSegment[], text: string): TurnSegment[] {
  const last = segments[segments.length - 1];
  if (last?.kind === 'text') {
    const next = [...segments];
    next[next.length - 1] = { ...last, text: `${last.text}${text}` };
    return next;
  }
  return [...segments, { id: uid('seg'), kind: 'text', text, at: Date.now() }];
}

function uid(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

function toChatTurn(message: ChatMessageView): ChatTurn {
  const segments: TurnSegment[] = (message.activity ?? []).map((event) => ({
    id: uid('seg'),
    kind: 'activity' as const,
    event,
  }));
  if (message.text.trim()) {
    segments.push({
      id: uid('seg'),
      kind: 'text',
      text: message.text,
      at: Date.now(),
    });
  }
  return {
    id: message.id,
    role: message.role,
    text: message.text,
    segments,
    mode: message.mode,
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
  const [approvalMode, setApprovalMode] = useState<ApprovalUiMode>('guided');
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
    maximumOutputTokens: 0,
  });
  const [profiles, setProfiles] = useState<SettingsProfileView[]>([]);
  const [activeProfileId, setActiveProfileId] = useState('default');
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [tokenUsage, setTokenUsage] =
    useState<TokenUsageSnapshot>(EMPTY_TOKEN_USAGE);
  const [testingConnection, setTestingConnection] = useState(false);
  const [connectionMessage, setConnectionMessage] = useState<string | null>(
    null,
  );
  const [customModel, setCustomModel] = useState(false);
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
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
  const profileMenuRef = useRef<HTMLDivElement>(null);
  const stickToBottomRef = useRef(true);
  const forceScrollToBottomRef = useRef(false);
  const lastTurnCountRef = useRef(0);
  const activeAssistantId = useRef<string | null>(null);
  const modeRef = useRef<AgentUiMode>(mode);
  const uiRef = useRef<UiSettingsSnapshot>(ui);
  const providerRef = useRef<ProviderSettingsSnapshot>(provider);
  const listModelsTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hydratedModeDefaults = useRef(false);

  const updateProvider = (
    next:
      | ProviderSettingsSnapshot
      | ((prev: ProviderSettingsSnapshot) => ProviderSettingsSnapshot),
  ) => {
    setProvider((prev) => {
      const resolved = typeof next === 'function' ? next(prev) : next;
      providerRef.current = resolved;
      return resolved;
    });
  };

  const applyTokenUsage = useCallback(
    (usage: TokenUsageSnapshot) => {
      setTokenUsage((prev) => {
        const shouldKeepLiveBreakdown =
          usage.contextBreakdown === undefined && usage.live && prev.live;
        const providerContextWindow =
          providerRef.current.contextWindow || provider.contextWindow;
        return {
          ...usage,
          contextWindow:
            usage.contextWindow ||
            providerContextWindow ||
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
      updateProvider({
        ...msg.provider,
        contextWindow: Number.isFinite(msg.provider.contextWindow)
          ? msg.provider.contextWindow
          : 32768,
        maximumOutputTokens: Number.isFinite(msg.provider.maximumOutputTokens)
          ? msg.provider.maximumOutputTokens
          : 0,
      });
      setProfiles(msg.profiles ?? []);
      setActiveProfileId(msg.activeProfileId ?? 'default');
      setMcp(msg.mcp);
      setMcpStore(msg.mcpStore ?? []);
      setMcpRuntimeStatus(msg.mcpRuntimeStatus);
      const nextUi = {
        ...DEFAULT_UI,
        ...msg.ui,
        modeDefaults: {
          ...DEFAULT_UI.modeDefaults,
          ...msg.ui.modeDefaults,
        },
        contextToggles: {
          ...DEFAULT_CONTEXT_TOGGLES,
          ...msg.ui.contextToggles,
        },
        runBudget: {
          ...DEFAULT_RUN_BUDGET,
          ...msg.ui.runBudget,
        },
        tokenBudget: {
          ...DEFAULT_TOKEN_BUDGET,
          ...msg.ui.tokenBudget,
          policy: {
            ...DEFAULT_TOKEN_BUDGET.policy,
            ...(msg.ui.tokenBudget?.policy ?? {}),
          },
          fields:
            msg.ui.tokenBudget?.fields?.length
              ? msg.ui.tokenBudget.fields
              : DEFAULT_TOKEN_BUDGET.fields,
          preview: msg.ui.tokenBudget?.preview ?? DEFAULT_TOKEN_BUDGET.preview,
        },
      };
      const previousUi = uiRef.current;
      uiRef.current = nextUi;
      setUi(nextUi);
      const modeDefaultsChanged =
        JSON.stringify(previousUi.modeDefaults) !==
          JSON.stringify(nextUi.modeDefaults) ||
        previousUi.depth !== nextUi.depth ||
        previousUi.approvalMode !== nextUi.approvalMode;
      if (!hydratedModeDefaults.current || modeDefaultsChanged) {
        hydratedModeDefaults.current = true;
        const currentDefaults = modeDefaultsFromUi(nextUi, modeRef.current);
        setDepth(currentDefaults.depth);
        setApprovalMode(normalizeApproval(currentDefaults.approvalMode));
      }
      setOverrideDraft(msg.workspace.rootOverride ?? '');
      applyTokenUsage(msg.tokenUsage);
      setNotice(msg.notice);
      setCustomModel((wasCustom) => {
        const nextModel = msg.provider.model?.trim() ?? '';
        const catalog = new Set([
          ...(msg.provider.availableModels ?? []),
          ...modelsForProvider(msg.provider.preset ?? msg.provider.type),
        ]);
        return Boolean(nextModel) && (wasCustom || !catalog.has(nextModel));
      });
      if (msg.provider.connectionStatus) {
        setConnectionMessage(msg.provider.connectionStatus);
      }
      setSettingsSaving(false);
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

  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);

  useEffect(() => {
    uiRef.current = ui;
  }, [ui]);

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
              segments: [],
            },
            {
              id: asstId,
              role: 'assistant',
              text: '',
              mode: msg.mode,
              streaming: true,
              segments: [],
            },
          ]);
          break;
        }
        case 'run.event': {
          const id = activeAssistantId.current;
          if (!id) break;
          if (msg.event.kind === 'delta') break;
          if (msg.event.kind === 'thinking' && !ui.showReasoning) break;
          // "Preparing tool" is a transient placeholder immediately superseded
          // by "Running <tool>" a moment later — drop it, it adds noise without signal.
          if (msg.event.kind === 'tool' && msg.event.title === 'Preparing tool') {
            break;
          }
          setTurns((prev) =>
            prev.map((t) =>
              t.id === id
                ? {
                    ...t,
                    segments: appendActivitySegment(
                      t.segments,
                      msg.event,
                      ui.reasoningPreviewMaxChars,
                    ),
                  }
                : t,
            ),
          );
          break;
        }
        case 'run.delta': {
          const id = activeAssistantId.current;
          if (!id) break;
          setTurns((prev) =>
            prev.map((t) =>
              t.id === id
                ? {
                    ...t,
                    text: `${t.text}${msg.text}`,
                    segments: appendTextSegment(t.segments, msg.text),
                  }
                : t,
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
              // Streamed segments already display correctly; only when the
              // final answer overrides them do we collapse the streamed text
              // into one trailing segment, keeping prior activity groups intact.
              const segments =
                nextText === t.text
                  ? t.segments
                  : [
                      ...t.segments.filter((seg) => seg.kind === 'activity'),
                      {
                        id: uid('seg'),
                        kind: 'text' as const,
                        text: nextText,
                        at: Date.now(),
                      },
                    ];
              return {
                ...t,
                streaming: false,
                status: msg.status,
                route: msg.route,
                text: nextText,
                segments,
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
          setSettingsSaving(false);
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
            contextWindow:
              providerRef.current.contextWindow || provider.contextWindow || 32768,
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
            updateProvider((p) => ({
              ...p,
              availableModels: mergeModelOptions(msg.models, p.model),
              connectionOk: msg.ok,
              connectionStatus: msg.message,
            }));
          } else if (!msg.testing) {
            updateProvider((p) => ({
              ...p,
              connectionOk: msg.ok,
              connectionStatus: msg.message,
            }));
          }
          break;
        case 'provider.models':
          updateProvider((p) => ({
            ...p,
            availableModels: mergeModelOptions(msg.models, p.model),
          }));
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
      approvalMode,
      pinnedPaths: pinned.map((p) => p.path),
    });
    setPrompt('');
    setSuggestLoading(false);
    setSuggestOpen(false);
  }, [prompt, running, mode, depth, approvalMode, pinned]);

  const executePendingPlan = useCallback(() => {
    if (running) return;
    stickToBottomRef.current = true;
    forceScrollToBottomRef.current = true;
    const agentDefaults = modeDefaultsFromUi(ui, 'agent');
    setMode('agent');
    setDepth(agentDefaults.depth);
    setApprovalMode(normalizeApproval(agentDefaults.approvalMode));
    const nextModel = agentDefaults.model?.trim();
    if (nextModel) saveModel(nextModel);
    postToHost({
      type: 'ask',
      prompt: 'Implement the pending plan.',
      mode: 'agent',
      depth: agentDefaults.depth,
      approvalMode: agentDefaults.approvalMode,
      pinnedPaths: pinned.map((p) => p.path),
    });
    setPrompt('');
    setSuggestLoading(false);
    setSuggestOpen(false);
  }, [running, ui, pinned]);

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

  const testConnection = () => {
    setTestingConnection(true);
    setConnectionMessage('Testing…');
    const current = providerRef.current;
    postToHost({
      type: 'provider.testConnection',
      provider: {
        type: current.type,
        baseUrl: current.baseUrl,
        model: current.model,
      },
    });
  };

  const requestListedModels = (
    type: string,
    baseUrl: string,
    immediate = false,
  ) => {
    if (listModelsTimerRef.current) {
      clearTimeout(listModelsTimerRef.current);
      listModelsTimerRef.current = null;
    }
    const send = () => {
      if (type === 'echo') return;
      postToHost({
        type: 'provider.listModels',
        provider: { type, baseUrl },
      });
    };
    if (immediate) {
      send();
      return;
    }
    listModelsTimerRef.current = setTimeout(send, 400);
  };

  const handleProviderChange = (
    next:
      | ProviderSettingsSnapshot
      | ((prev: ProviderSettingsSnapshot) => ProviderSettingsSnapshot),
  ) => {
    const before = providerRef.current;
    updateProvider(next);
    const after = providerRef.current;
    if (after.type !== before.type) {
      requestListedModels(after.type, after.baseUrl, true);
    } else if (after.baseUrl !== before.baseUrl) {
      requestListedModels(after.type, after.baseUrl);
    }
  };

  const onProviderTypeChange = (presetId: string) => {
    const preset = getProviderPreset(presetId);
    const type = preset?.type ?? presetId;
    updateProvider((p) => ({
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
    const current = providerRef.current;
    requestListedModels(current.type, current.baseUrl, true);
  };

  const modelOptions = useMemo(
    () =>
      mergeModelOptions(
        [
          ...modelsForProvider(provider.preset ?? provider.type),
          ...(provider.availableModels ?? []),
        ],
        provider.model,
      ),
    [provider.availableModels, provider.model, provider.preset, provider.type],
  );
  const selectedModelIsCustom =
    customModel || !modelOptions.includes(provider.model);
  const selectedModelLabel = selectedModelIsCustom
    ? provider.model.trim() || 'Custom model'
    : provider.model || 'Select model';

  const saveModel = (model: string) => {
    updateProvider((p) => ({ ...p, model }));
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

  useEffect(() => {
    if (!profileMenuOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!profileMenuRef.current?.contains(event.target as Node)) {
        setProfileMenuOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setProfileMenuOpen(false);
    };
    window.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [profileMenuOpen]);

  const changeApprovalMode = (next: ApprovalUiMode) => {
    setApprovalMode(next);
  };

  const changeMode = (next: AgentUiMode) => {
    setMode(next);
    const defaults = modeDefaultsFromUi(ui, next);
    setDepth(defaults.depth);
    setApprovalMode(normalizeApproval(defaults.approvalMode));
    const nextModel = defaults.model?.trim();
    if (nextModel) saveModel(nextModel);
  };

  const changeDepth = (next: AgentUiDepth) => {
    setDepth(next);
  };

  const updateUiDraft = (patch: UiSettingsPatch) => {
    const next = mergeUiPatch(uiRef.current, patch);
    uiRef.current = next;
    setUi(next);
    if (patch.depth) setDepth(patch.depth);
    const activeModePatch = patch.modeDefaults?.[settingsModeFor(mode)];
    const activeModeDepth = activeModePatch?.depth;
    if (activeModeDepth) setDepth(activeModeDepth);
    if (activeModePatch?.approvalMode) {
      setApprovalMode(normalizeApproval(activeModePatch.approvalMode));
    }
    const activeModeModel = activeModePatch?.model?.trim();
    if (activeModeModel) {
      updateProvider((prev) => ({
        ...prev,
        model: activeModeModel,
      }));
    }
  };

  const activeProfile = useMemo(
    () =>
      profiles.find((profile) => profile.id === activeProfileId) ??
      profiles[0],
    [activeProfileId, profiles],
  );
  const selectedProfileLabel = activeProfile?.name ?? 'Default';

  const snapshotProvider = () => {
    const current = providerRef.current;
    return {
      type: current.type,
      preset: current.preset,
      baseUrl: current.baseUrl,
      model: current.model,
      contextWindow: current.contextWindow,
      maximumOutputTokens: current.maximumOutputTokens,
    };
  };

  const applyProfileLocally = (profile: SettingsProfileView) => {
    setActiveProfileId(profile.id);
    updateProvider((prev) => ({
      ...prev,
      ...profile.provider,
      hasApiKey: profile.hasSecret,
      availableModels: prev.availableModels,
    }));
  };

  const switchProfile = (id: string) => {
    const profile = profiles.find((entry) => entry.id === id);
    if (!profile || profile.id === activeProfileId) return;
    applyProfileLocally(profile);
    postToHost({ type: 'profile.switch', id: profile.id });
  };

  const createProfile = (name: string) => {
    const id = `profile-${Date.now().toString(36)}`;
    const trimmed = name.trim() || 'New profile';
    const nextProfile: SettingsProfileView = {
      id,
      name: trimmed,
      provider: snapshotProvider(),
      hasSecret: provider.hasApiKey,
    };
    setProfiles((prev) => [...prev, nextProfile]);
    applyProfileLocally(nextProfile);
    setSettingsSaving(true);
    postToHost({
      type: 'settings.set',
      provider: snapshotProvider(),
      profile: nextProfile,
    });
  };

  const saveAllSettings = () => {
    (document.activeElement as HTMLElement | null)?.blur?.();
    const latestUi = uiRef.current;
    const profile = activeProfile ?? {
      id: activeProfileId || 'default',
      name: 'Default',
      provider: snapshotProvider(),
      hasSecret: provider.hasApiKey,
    };
    setSettingsSaving(true);
    postToHost({
      type: 'settings.set',
      provider: snapshotProvider(),
      ui: {
        ...latestUi,
        approvalMode,
      },
      workspaceRootOverride: overrideDraft.trim() || null,
      mcp,
      approvalMode,
      profile: {
        ...profile,
        provider: snapshotProvider(),
      },
    });
    setTokenUsage((prev) => ({
      ...prev,
      contextWindow:
        providerRef.current.contextWindow || prev.contextWindow,
    }));
  };

  const requestSkills = () => {
    setSkillLoading(true);
    postToHost({ type: 'requestSkillCatalog', requestId: uid('skill') });
  };

  useEffect(() => {
    if (nav === 'skills' && skillManagement) requestSkills();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nav, skillManagement]);

  const followingPlan = mode === 'plan' && Boolean(plan?.steps.length);

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
          {/* <div className="brand-sub">Enterprise workspace agent</div> */}
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
                approvalMode={approvalMode}
                depth={depth}
                onModeChange={changeMode}
                onApprovalModeChange={changeApprovalMode}
                onDepthChange={changeDepth}
              />
            </div>
          </div>
        ) : (
          <div className={`chat-view${running ? ' chat-view--running' : ''}`}>
            <MessageList
              turns={turns}
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
                      approvalMode={approvalMode}
                      depth={depth}
                      onModeChange={changeMode}
                      onApprovalModeChange={changeApprovalMode}
                      onDepthChange={changeDepth}
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
                          updateProvider((p) => ({
                            ...p,
                            model: e.target.value,
                          }))
                        }
                        onBlur={() => {
                          const model = providerRef.current.model.trim();
                          if (model) saveModel(model);
                        }}
                        title="Custom model id"
                      />
                    ) : null}
                  </div>
                  <div className="composer-utility-row">
                    <div className="composer-left">
                      <TokenMeter usage={tokenUsage} placement="above" />
                      <select
                        className="composer-link-select"
                        aria-label="Profile"
                        title={`Profile: ${selectedProfileLabel}`}
                        value={activeProfileId}
                        onChange={(e) => switchProfile(e.target.value)}
                      >
                        {profiles.map((profile) => (
                          <option key={profile.id} value={profile.id}>
                            {profile.name}
                          </option>
                        ))}
                      </select>
                      <select
                        className="composer-link-select composer-link-select--model"
                        aria-label="Model"
                        title={`Model: ${selectedModelLabel}`}
                        value={
                          selectedModelIsCustom ? '__custom__' : provider.model
                        }
                        onChange={(e) => {
                          if (e.target.value === '__custom__') {
                            setCustomModel(true);
                            return;
                          }
                          setCustomModel(false);
                          saveModel(e.target.value);
                        }}
                      >
                        {modelOptions.map((id) => (
                          <option key={id} value={id}>
                            {id}
                          </option>
                        ))}
                        <option value="__custom__">Custom…</option>
                      </select>
                      {selectedModelIsCustom ? (
                        <input
                          className="model-custom-input model-custom-input--inline"
                          value={provider.model}
                          placeholder="model id"
                          onChange={(e) =>
                            updateProvider((p) => ({
                              ...p,
                              model: e.target.value,
                            }))
                          }
                          onBlur={() => {
                            const model = providerRef.current.model.trim();
                            if (model) saveModel(model);
                          }}
                          title="Custom model id"
                        />
                      ) : null}
                      <div
                        className="composer-dropdown composer-dropdown--profile"
                        ref={profileMenuRef}
                        style={
                          {
                            '--composer-control-color': '#22c55e',
                          } as CSSProperties
                        }
                      >
                        <button
                          type="button"
                          className="composer-dropdown__button composer-dropdown__button--link"
                          aria-haspopup="listbox"
                          aria-expanded={profileMenuOpen}
                          aria-label="Profile"
                          title={`Profile: ${selectedProfileLabel}`}
                          onClick={() => setProfileMenuOpen((open) => !open)}
                        >
                          <span className="composer-dropdown__value">
                            <span className="composer-dropdown__icon" aria-hidden>
                              <IconSettings />
                            </span>
                            <span>{selectedProfileLabel}</span>
                          </span>
                          <span className="composer-dropdown__chevron" aria-hidden>
                            ▾
                          </span>
                        </button>
                        {profileMenuOpen ? (
                          <div
                            className="composer-dropdown__menu"
                            role="listbox"
                            aria-label="Profile"
                          >
                            {profiles.map((profile) => {
                              const selectedOption =
                                profile.id === activeProfileId;
                              return (
                                <button
                                  key={profile.id}
                                  type="button"
                                  className={[
                                    'composer-dropdown__option',
                                    selectedOption
                                      ? 'composer-dropdown__option--selected'
                                      : '',
                                  ]
                                    .filter(Boolean)
                                    .join(' ')}
                                  role="option"
                                  aria-selected={selectedOption}
                                  title={`Use ${profile.name}`}
                                  onClick={() => {
                                    setProfileMenuOpen(false);
                                    switchProfile(profile.id);
                                  }}
                                >
                                  <span
                                    className="composer-dropdown__option-icon"
                                    aria-hidden
                                  >
                                    <IconSettings />
                                  </span>
                                  <span className="composer-dropdown__option-text">
                                    <span>{profile.name}</span>
                                    <small>
                                      {profile.provider.preset ??
                                        profile.provider.type}{' '}
                                      · {profile.provider.model}
                                    </small>
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
                          </div>
                        ) : null}
                      </div>
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
          onClearOverride={() => {
            setOverrideDraft('');
          }}
          onOpenFolder={() => postToHost({ type: 'openFolder' })}
          profiles={profiles}
          activeProfileId={activeProfileId}
          onActiveProfileChange={switchProfile}
          onCreateProfile={createProfile}
          provider={provider}
          onProviderChange={handleProviderChange}
          onProviderTypeChange={onProviderTypeChange}
          onSetApiKey={() => postToHost({ type: 'settings.setApiKey' })}
          onClearApiKey={() => postToHost({ type: 'settings.clearApiKey' })}
          onTestConnection={testConnection}
          testingConnection={testingConnection}
          connectionMessage={connectionMessage}
          customModel={customModel}
          onCustomModelChange={setCustomModel}
          modelOptions={modelOptions}
          ui={ui}
          onSaveUi={updateUiDraft}
          mcp={mcp}
          mcpStore={mcpStore}
          mcpRuntimeStatus={mcpRuntimeStatus}
          onMcpChange={setMcp}
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
            updateUiDraft({ contextToggles: { [source]: enabled } });
          }}
          onSaveAll={saveAllSettings}
          saving={settingsSaving}
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
