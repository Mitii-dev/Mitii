import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { onHostMessage, postToHost } from './bridge';
import { ContextPanel } from './components/ContextPanel';
import { ErrorBanner } from './components/ErrorBanner';
import { HistoryPanel } from './components/HistoryPanel';
import { IconButton } from './components/IconButton';
import {
  IconChat,
  IconCopy,
  IconHistory,
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
import { PlanPanel } from './components/PlanPanel';
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
  SettingsTab,
  SkillCatalogItem,
  TokenUsageSnapshot,
  UiNav,
  UiSettingsSnapshot,
  WorkspaceNoticeView,
  WorkspaceSnapshotInfo,
} from './protocol';
import { TokenMeter } from './TokenMeter';

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

const DEFAULT_UI: UiSettingsSnapshot = {
  showReasoning: true,
  reasoningPreviewMaxChars: 8000,
  depth: 'auto',
  contextToggles: DEFAULT_CONTEXT_TOGGLES,
  approvalMode: 'guided',
};

function uid(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
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
  const [pinned, setPinned] = useState<string[]>([]);
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<PathSuggestion[]>([]);
  const [suggestOpen, setSuggestOpen] = useState(false);
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
  const [review, setReview] = useState<ReviewDiffView | null>(null);
  const [skillItems, setSkillItems] = useState<SkillCatalogItem[]>([]);
  const [skillError, setSkillError] = useState<string | null>(null);
  const [skillLoading, setSkillLoading] = useState(false);

  const searchReq = useRef(0);
  const lastSearchId = useRef('');
  const bottomRef = useRef<HTMLDivElement>(null);
  const activeAssistantId = useRef<string | null>(null);

  const navigate = useCallback(
    (next: UiNav, nextSettingsTab?: SettingsTab) => {
      setNav(next);
      if (nextSettingsTab) setSettingsTab(nextSettingsTab);
      postToHost({
        type: 'navigate',
        nav: next,
        settingsTab: nextSettingsTab,
      });
      postToHost({ type: 'setTab', tab: next });
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
      });
      setDepth(msg.ui.depth);
      setOverrideDraft(msg.workspace.rootOverride ?? '');
      setTokenUsage(msg.tokenUsage);
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
        setMemories(msg.memories);
        setCheckpoints(msg.checkpoints);
      }
    }
  }, []);

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
              nextActivity.push(msg.event);
              return { ...t, activity: nextActivity.slice(-40) };
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
        case 'run.result': {
          setRunning(false);
          const id = activeAssistantId.current;
          activeAssistantId.current = null;
          if (msg.plan !== undefined) setPlan(msg.plan ?? null);
          setTurns((prev) =>
            prev.map((t) => {
              if (!id || t.id !== id) return t;
              return {
                ...t,
                streaming: false,
                status: msg.status,
                route: msg.route,
                text: msg.answer?.trim()
                  ? msg.answer
                  : msg.error
                    ? `Error: ${msg.error}`
                    : t.text || `(${msg.status})`,
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
            setSuggestOpen(msg.suggestions.length > 0);
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
          setPinned((prev) =>
            prev.includes(msg.path) ? prev : [...prev, msg.path],
          );
          break;
        case 'workspaceNotice':
          setNotice(msg.notice);
          break;
        case 'history':
          setHistory(msg.threads);
          setActiveThreadId(msg.activeThreadId);
          break;
        case 'thread.loaded':
          setActiveThreadId(msg.threadId);
          setTurns(
            msg.messages.map((m) => ({
              id: m.id,
              role: m.role,
              text: m.text,
              mode: m.mode,
              activity: [],
            })),
          );
          setNav('chat');
          break;
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
          setTokenUsage(msg.usage);
          break;
        default:
          break;
      }
    });
    postToHost({ type: 'ready' });
    return off;
  }, [applyBootstrap, ui.reasoningPreviewMaxChars, ui.showReasoning]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [turns, running]);

  const send = useCallback(() => {
    const text = prompt.trim();
    if (!text || running) return;
    postToHost({
      type: 'ask',
      prompt: text,
      mode,
      depth,
      pinnedPaths: pinned,
    });
    setPrompt('');
    setSuggestOpen(false);
  }, [prompt, running, mode, depth, pinned]);

  const onPromptChange = (value: string) => {
    setPrompt(value);
    const match = value.match(/@([\w./_-]*)$/);
    if (match) {
      const q = match[1] ?? '';
      setSuggestQuery(q);
      const requestId = String(++searchReq.current);
      lastSearchId.current = requestId;
      postToHost({ type: 'paths.search', query: q, requestId });
    } else {
      setSuggestOpen(false);
    }
  };

  const insertMention = (path: string) => {
    const replaced = prompt.replace(/@([\w./_-]*)$/, `@${path} `);
    setPrompt(replaced);
    setPinned((prev) => (prev.includes(path) ? prev : [...prev, path]));
    setSuggestOpen(false);
  };

  const saveProvider = () => {
    postToHost({
      type: 'settings.set',
      provider: {
        type: provider.type,
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

  const onProviderTypeChange = (type: string) => {
    const preset = getProviderPreset(type);
    setProvider((p) => ({
      ...p,
      type,
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

  const saveModel = (model: string) => {
    setProvider((p) => ({ ...p, model }));
    postToHost({
      type: 'settings.set',
      provider: { model },
    });
  };

  const saveUi = (patch: Partial<UiSettingsSnapshot>) => {
    const next = {
      ...ui,
      ...patch,
      contextToggles: patch.contextToggles
        ? { ...ui.contextToggles, ...patch.contextToggles }
        : ui.contextToggles,
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
          <div className="brand-sub">Enterprise agent</div>
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
            onReindex={() => postToHost({ type: 'index.reindex' })}
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
            <PlanPanel plan={plan} />
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
                  return;
                }
                if (!approvalId) return;
                postToHost({
                  type: 'resume',
                  runId,
                  approval: { approvalId, decision: 'approved' },
                });
              }}
              onDeny={(runId, approvalId) => {
                const turn = turns.find((t) => t.suspension?.runId === runId);
                if (turn?.suspension?.kind === 'plan_approval_required') {
                  postToHost({
                    type: 'resume',
                    runId,
                    planDecision: { decision: 'rejected' },
                  });
                  return;
                }
                if (!approvalId) return;
                postToHost({
                  type: 'resume',
                  runId,
                  approval: { approvalId, decision: 'denied' },
                });
              }}
              onShowInlineDiff={(approvalId) =>
                postToHost({ type: 'showInlineDiff', approvalId })
              }
              bottomRef={bottomRef}
            />

            <div className="composer-dock">
              <ContextPanel
                paths={pinned}
                onRemove={(path) =>
                  setPinned((prev) => prev.filter((x) => x !== path))
                }
                onClear={() => setPinned([])}
                onPick={() => postToHost({ type: 'pickContextPath' })}
              />

              <div className="composer-box">
                {suggestOpen ? (
                  <div className="suggest-pop" role="listbox">
                    {suggestions.map((s, i) => (
                      <button
                        key={s.path}
                        type="button"
                        className={`suggest-item ${i === activeSuggest ? 'active' : ''}`}
                        onClick={() => insertMention(s.path)}
                      >
                        <span className="mono">@{s.path}</span>
                        <span className="suggest-kind">{s.kind}</span>
                      </button>
                    ))}
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
                    <select
                      className="depth-select model-select"
                      value={
                        customModel || !modelOptions.includes(provider.model)
                          ? '__custom__'
                          : provider.model
                      }
                      onChange={(e) => {
                        const next = e.target.value;
                        if (next === '__custom__') {
                          setCustomModel(true);
                          return;
                        }
                        setCustomModel(false);
                        saveModel(next);
                      }}
                      title="Model"
                      aria-label="Model"
                    >
                      {modelOptions.map((id) => (
                        <option key={id} value={id}>
                          {id}
                        </option>
                      ))}
                      <option value="__custom__">Custom…</option>
                    </select>
                    {customModel || !modelOptions.includes(provider.model) ? (
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
